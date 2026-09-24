// Deploys the full Eco-Fraction contract suite to the local chain and writes
// deployments/localhost.json (addresses + ABIs) for the backend and frontend.
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const SHARE_PRICE = USDC(10);
const OFFERED_FRACTION = 5n; // 1/5 = 20% of each asset offered to investors
const FEE_BPS = 100; // 1%
const MIN_INVESTMENT = USDC(50);
const TARIFF_PER_KWH = USDC("0.05"); // PPA tariff paid by the grid buyer
const CAPEX_PER_KW = { solar: 800, wind: 1300 }; // USD, used to value each asset

const assets = require("../../shared/assets.json");

async function waitForChain() {
  for (let i = 0; i < 30; i++) {
    try {
      return await ethers.provider.getBlockNumber();
    } catch {
      console.log("waiting for chain...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("chain not reachable at " + network.config.url);
}

async function main() {
  await waitForChain();
  const [deployer, platform, offtaker, signer1, signer2, signer3, solarProducer, windProducer, treasury] =
    await ethers.getSigners();
  const producers = { solar: solarProducer, wind: windProducer };

  const usdc = await ethers.deployContract("MockUSDC", [deployer]);
  const kyc = await ethers.deployContract("KYCRegistry", [deployer]);
  const token = await ethers.deployContract("AssetToken", [deployer, kyc, "http://localhost:8100/api/assets/{id}/metadata"]);
  const oracle = await ethers.deployContract("EnergyOracle", [deployer, platform]);
  const distributor = await ethers.deployContract("RevenueDistributor", [
    deployer, usdc, token, oracle, offtaker, TARIFF_PER_KWH,
  ]);
  const primary = await ethers.deployContract("PrimaryMarket", [deployer, usdc, token, treasury, FEE_BPS, MIN_INVESTMENT]);
  const market = await ethers.deployContract("Marketplace", [deployer, usdc, token, treasury, FEE_BPS]);
  const multisig = await ethers.deployContract("MultiSig", [[signer1, signer2, signer3], 2]);
  for (const c of [usdc, kyc, token, oracle, distributor, primary, market, multisig]) await c.waitForDeployment();
  await token.setRevenueHook(distributor);

  // Producers pass KYC and tokenize their assets
  for (const p of Object.values(producers)) {
    await kyc.verify(p);
    await token.connect(p).setApprovalForAll(primary, true);
    await token.connect(p).setApprovalForAll(market, true);
  }
  const assetInfo = [];
  for (const a of assets) {
    const valueUsd = BigInt(a.capacity_kw * CAPEX_PER_KW[a.kind]);
    const totalShares = valueUsd / 10n;
    const offered = totalShares / OFFERED_FRACTION;
    await token.createAsset(a.tokenId, a.name, producers[a.producer], totalShares, SHARE_PRICE);
    await primary.openOffering(a.tokenId, offered);
    assetInfo.push({ ...a, valueUsd: Number(valueUsd), totalShares: Number(totalShares), offeredShares: Number(offered) });
  }

  // Grid buyer funds its PPA payments
  await usdc.mint(offtaker, USDC(100_000_000));
  await usdc.connect(offtaker).approve(distributor, ethers.MaxUint256);

  // Operational roles for the platform backend
  await kyc.grantRole(await kyc.VERIFIER_ROLE(), platform);
  await distributor.grantRole(await distributor.KEEPER_ROLE(), platform);
  await usdc.grantRole(await usdc.MINTER_ROLE(), platform); // fiat on-ramp (Open Banking sandbox)

  // Hand every admin power to the 2-of-3 multisig, then drop the deployer's keys
  const handover = [
    [token, ["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "PAUSER_ROLE"]],
    [kyc, ["DEFAULT_ADMIN_ROLE", "VERIFIER_ROLE"]],
    [oracle, ["DEFAULT_ADMIN_ROLE"]],
    [distributor, ["DEFAULT_ADMIN_ROLE", "ESCROW_ADMIN_ROLE"]],
    [primary, ["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "FEE_ADMIN_ROLE"]],
    [market, ["DEFAULT_ADMIN_ROLE", "FEE_ADMIN_ROLE"]],
  ];
  for (const [contract, roles] of handover) {
    for (const r of roles) await contract.grantRole(await contract[r](), multisig);
    // Renounce admin last, otherwise the deployer can no longer renounce the other roles
    for (const r of [...roles].reverse()) await contract.renounceRole(await contract[r](), deployer);
  }

  const contracts = { usdc, kyc, token, oracle, distributor, primary, market, multisig };
  const names = {
    usdc: "MockUSDC", kyc: "KYCRegistry", token: "AssetToken", oracle: "EnergyOracle",
    distributor: "RevenueDistributor", primary: "PrimaryMarket", market: "Marketplace", multisig: "MultiSig",
  };
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    // Account index in the dev mnemonic -> role (the backend derives keys from the mnemonic)
    accounts: {
      deployer: { index: 0, address: deployer.address },
      platform: { index: 1, address: platform.address },
      offtaker: { index: 2, address: offtaker.address },
      multisigSigners: [signer1, signer2, signer3].map((s, i) => ({ index: 3 + i, address: s.address })),
      solarProducer: { index: 6, address: solarProducer.address },
      windProducer: { index: 7, address: windProducer.address },
      treasury: { index: 8, address: treasury.address },
    },
    params: {
      sharePriceUsdc: 10, offeredPercent: 20, feeBps: FEE_BPS, minInvestmentUsdc: 50, tariffPerKWhUsdc: 0.05,
    },
    assets: assetInfo,
    contracts: {},
  };
  for (const [key, c] of Object.entries(contracts)) {
    out.contracts[key] = { address: await c.getAddress(), abi: (await artifacts.readArtifact(names[key])).abi };
  }

  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`Deployed to ${network.name} (chain ${out.chainId})`);
  for (const [key, c] of Object.entries(out.contracts)) console.log(`  ${names[key].padEnd(19)} ${c.address}`);
  for (const a of assetInfo) {
    console.log(`  #${a.tokenId} ${a.name.padEnd(24)} $${(a.valueUsd / 1e6).toFixed(0)}M  ${a.offeredShares.toLocaleString()} shares offered`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
