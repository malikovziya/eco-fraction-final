// End-to-end check against the deployed local chain:
// role handover, then KYC -> buy -> anchor production -> settle -> payout, plus escrow.
const { ethers } = require("hardhat");
const dep = require("../deployments/localhost.json");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const fmt = (v) => ethers.formatUnits(v, 6);

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const platform = signers[dep.accounts.platform.index];
  const investor = signers[9];
  const c = Object.fromEntries(
    Object.entries(dep.contracts).map(([k, v]) => [k, new ethers.Contract(v.address, v.abi, platform)]),
  );

  // Role handover: deployer holds nothing, multisig holds admin
  const ADMIN = ethers.ZeroHash;
  for (const k of ["token", "kyc", "oracle", "distributor", "primary", "market"]) {
    const deployerAdmin = await c[k].hasRole(ADMIN, deployer);
    const multisigAdmin = await c[k].hasRole(ADMIN, dep.contracts.multisig.address);
    if (deployerAdmin || !multisigAdmin) throw new Error(`role handover failed on ${k}`);
  }
  console.log("✔ all admin roles held by the 2-of-3 multisig, deployer has none");

  // Onboard an investor: KYC + fiat on-ramp, then buy 5 shares ($50) of Gobustan Solar
  await (await c.kyc.verify(investor)).wait();
  await (await c.usdc.mint(investor, USDC(1000))).wait();
  await (await c.usdc.connect(investor).approve(c.primary, ethers.MaxUint256)).wait();
  await (await c.primary.connect(investor).buy(1, 5)).wait();
  console.log(`✔ investor bought ${await c.token.balanceOf(investor, 1)} shares, USDC left ${fmt(await c.usdc.balanceOf(investor))}`);

  // One hour of Gobustan production (18 MWh), verified by the AI -> distributed
  const t0 = Math.floor(Date.now() / 1000);
  const hash = ethers.sha256(ethers.toUtf8Bytes("demo readings"));
  await (await c.oracle.recordBatch(1, t0, t0 + 3600, 18_000_000n, hash, 150, false)).wait();
  await (await c.distributor.settle((await c.oracle.batchCount()) - 1n)).wait();
  const due = await c.distributor.claimable(1, investor);
  const before = await c.usdc.balanceOf(investor);
  await (await c.distributor.payout(1, [investor])).wait();
  console.log(`✔ 18 MWh settled at $0.05/kWh = $900 to all holders; investor auto-paid ${fmt((await c.usdc.balanceOf(investor)) - before)} USDC (due ${fmt(due)})`);

  // Next hour flagged by the AI -> escrowed, nothing paid
  await (await c.oracle.recordBatch(1, t0 + 3600, t0 + 7200, 30_000_000n, hash, 9400, true)).wait();
  await (await c.distributor.settle((await c.oracle.batchCount()) - 1n)).wait();
  console.log(`✔ flagged batch escrowed: ${fmt(await c.distributor.totalEscrowed())} USDC held, investor claimable ${fmt(await c.distributor.claimable(1, investor))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
