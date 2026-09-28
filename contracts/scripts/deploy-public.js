// Deploys the Eco-Fraction contracts to a public testnet (Polygon Amoy) with a single funded wallet,
// so judges can inspect them on a public explorer. The live demo keeps running on the local chain.
//
//   npx hardhat run scripts/deploy-public.js --network amoy
//
// Writes deployments/<network>.json (addresses) and deployments/<network>-signers.json (the two extra
// multisig signer keys, testnet only, gitignored).
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;

const USDC = (n) => ethers.parseUnits(String(n), 6);
const CAPEX_PER_KW = { solar: 800, wind: 1300 };
const assets = require("../../shared/assets.json");
const DEPLOY_GAS = 12_000_000n; // measured: 48 transactions, ~11.6M gas in total

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer key. Run: npx hardhat vars set AMOY_PRIVATE_KEY");
  const balance = await ethers.provider.getBalance(deployer);
  console.log(`Network ${network.name} · deployer ${deployer.address} · ${ethers.formatEther(balance)} POL`);
  if (network.name !== "hardhat") {
    // Check against today's gas price with a 50% margin, so the deployment never stops halfway
    const { gasPrice } = await ethers.provider.getFeeData();
    const needed = (DEPLOY_GAS * gasPrice * 3n) / 2n;
    console.log(`Gas price ${ethers.formatUnits(gasPrice, "gwei")} gwei · this deployment needs about ${ethers.formatEther(needed)} POL`);
    if (balance < needed) {
      throw new Error(`Not enough test POL: have ${ethers.formatEther(balance)}, need about ${ethers.formatEther(needed)}. ` +
        "Top up from a faucet (e.g. faucet.polygon.technology) and run again. Nothing was deployed.");
    }
  }

  // Two extra signers so the multisig is genuinely 2-of-3 (testnet-only keys, saved locally)
  const extra = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}-signers.json`),
    JSON.stringify(extra.map((w) => ({ address: w.address, privateKey: w.privateKey })), null, 2));

  const deploy = async (name, args) => {
    const c = await ethers.deployContract(name, args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(19)} ${await c.getAddress()}`);
    return c;
  };
  const send = async (p) => (await p).wait();

  const usdc = await deploy("MockUSDC", [deployer]);
  const kyc = await deploy("KYCRegistry", [deployer]);
  const token = await deploy("AssetToken", [deployer, kyc, "https://eco-fraction.demo/api/assets/{id}/metadata"]);
  const oracle = await deploy("EnergyOracle", [deployer, deployer]);
  const distributor = await deploy("RevenueDistributor", [deployer, usdc, token, oracle, deployer, USDC("0.05")]);
  const primary = await deploy("PrimaryMarket", [deployer, usdc, token, deployer, 100, USDC(50)]);
  const market = await deploy("Marketplace", [deployer, usdc, token, deployer, 100]);
  const multisig = await deploy("MultiSig", [[deployer.address, extra[0].address, extra[1].address], 2]);

  console.log("Configuring assets and roles...");
  await send(token.setRevenueHook(distributor));
  await send(kyc.verify(deployer));
  await send(token.setApprovalForAll(primary, true));
  for (const a of assets) {
    const totalShares = BigInt(a.capacity_kw * CAPEX_PER_KW[a.kind]) / 10n;
    await send(token.createAsset(a.tokenId, a.name, deployer, totalShares, USDC(10)));
    await send(primary.openOffering(a.tokenId, totalShares / 5n));
  }
  await send(distributor.grantRole(await distributor.KEEPER_ROLE(), deployer));

  // One real production batch on-chain, so the explorer shows the full oracle -> revenue flow
  await send(usdc.mint(deployer, USDC(10_000)));
  await send(usdc.approve(distributor, ethers.MaxUint256));
  const now = Math.floor(Date.now() / 1000);
  await send(oracle.recordBatch(1, now - 3600, now, 18_000_000n, ethers.sha256(ethers.toUtf8Bytes("sample batch")), 120, false));
  await send(distributor.settle(0));

  // Hand admin powers to the multisig, as on the local deployment
  for (const [c, roles] of [
    [token, ["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "PAUSER_ROLE"]],
    [distributor, ["DEFAULT_ADMIN_ROLE", "ESCROW_ADMIN_ROLE"]],
    [primary, ["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "FEE_ADMIN_ROLE"]],
    [market, ["DEFAULT_ADMIN_ROLE", "FEE_ADMIN_ROLE"]],
  ]) {
    for (const r of roles) await send(c.grantRole(await c[r](), multisig));
    for (const r of [...roles].reverse()) await send(c.renounceRole(await c[r](), deployer));
  }

  const contracts = { usdc, kyc, token, oracle, distributor, primary, market, multisig };
  const out = { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(), deployer: deployer.address,
    explorer: network.name === "amoy" ? "https://amoy.polygonscan.com" : null, contracts: {} };
  for (const [k, c] of Object.entries(contracts)) out.contracts[k] = await c.getAddress();
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`Saved deployments/${network.name}.json`);

  if (network.name === "amoy" && hre.config.etherscan.apiKey) {
    console.log("Verifying source code on Polygonscan...");
    const args = {
      usdc: [deployer.address], kyc: [deployer.address],
      token: [deployer.address, out.contracts.kyc, "https://eco-fraction.demo/api/assets/{id}/metadata"],
      oracle: [deployer.address, deployer.address],
      distributor: [deployer.address, out.contracts.usdc, out.contracts.token, out.contracts.oracle, deployer.address, USDC("0.05")],
      primary: [deployer.address, out.contracts.usdc, out.contracts.token, deployer.address, 100, USDC(50)],
      market: [deployer.address, out.contracts.usdc, out.contracts.token, deployer.address, 100],
      multisig: [[deployer.address, extra[0].address, extra[1].address], 2],
    };
    for (const [k, address] of Object.entries(out.contracts)) {
      try {
        await hre.run("verify:verify", { address, constructorArguments: args[k] });
      } catch (e) {
        console.log(`  ${k}: ${e.message.split("\n")[0]}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
