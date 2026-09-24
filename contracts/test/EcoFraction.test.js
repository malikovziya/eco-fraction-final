const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const ASSET = 1;
const SHARES = 1_000_000n; // $10M asset at $10/share
const PRICE = USDC(10);
const TARIFF = USDC("0.05"); // $/kWh
const HASH = ethers.keccak256(ethers.toUtf8Bytes("readings"));

async function deployFixture() {
  const [admin, platform, offtaker, s1, s2, s3, producer, treasury, alice, bob, mallory] =
    await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC", [admin]);
  const kyc = await ethers.deployContract("KYCRegistry", [admin]);
  const token = await ethers.deployContract("AssetToken", [admin, kyc, "ipfs://eco/{id}.json"]);
  const oracle = await ethers.deployContract("EnergyOracle", [admin, platform]);
  const distributor = await ethers.deployContract("RevenueDistributor", [
    admin, usdc, token, oracle, offtaker, TARIFF,
  ]);
  const primary = await ethers.deployContract("PrimaryMarket", [admin, usdc, token, treasury, 100, USDC(50)]);
  const market = await ethers.deployContract("Marketplace", [admin, usdc, token, treasury, 100]);
  const multisig = await ethers.deployContract("MultiSig", [[s1, s2, s3], 2]);

  await token.setRevenueHook(distributor);
  await distributor.grantRole(await distributor.KEEPER_ROLE(), platform);
  await distributor.grantRole(await distributor.ESCROW_ADMIN_ROLE(), multisig);
  for (const who of [producer, alice, bob]) await kyc.verify(who);

  await token.createAsset(ASSET, "Test Solar", producer, SHARES, PRICE);
  await primary.openOffering(ASSET, SHARES / 5n); // 20% offered
  await token.connect(producer).setApprovalForAll(primary, true);

  for (const who of [alice, bob]) {
    await usdc.mint(who, USDC(1_000_000));
    await usdc.connect(who).approve(primary, ethers.MaxUint256);
    await usdc.connect(who).approve(market, ethers.MaxUint256);
  }
  await usdc.mint(offtaker, USDC(1_000_000));
  await usdc.connect(offtaker).approve(distributor, ethers.MaxUint256);

  let period = 1_700_000_000;
  // Anchor a batch of `kwh` energy and settle it; returns the batch id
  async function produce(kwh, flagged = false) {
    const start = period;
    period += 3600;
    await oracle.connect(platform).recordBatch(ASSET, start, period, BigInt(kwh) * 1000n, HASH, flagged ? 9100 : 120, flagged);
    const id = (await oracle.batchCount()) - 1n;
    await distributor.connect(platform).settle(id);
    return id;
  }

  return { admin, platform, offtaker, s1, s2, s3, producer, treasury, alice, bob, mallory,
           usdc, kyc, token, oracle, distributor, primary, market, multisig, produce };
}

describe("KYC-gated asset shares", function () {
  it("tokenizes an asset with all shares held by the producer", async function () {
    const { token, producer } = await loadFixture(deployFixture);
    expect(await token.balanceOf(producer, ASSET)).to.equal(SHARES);
    expect(await token["totalSupply(uint256)"](ASSET)).to.equal(SHARES);
  });

  it("blocks transfers to wallets without KYC", async function () {
    const { token, producer, mallory } = await loadFixture(deployFixture);
    await expect(token.connect(producer).safeTransferFrom(producer, mallory, ASSET, 10, "0x"))
      .to.be.revertedWithCustomError(token, "NotKYCVerified").withArgs(mallory.address);
  });

  it("freezes all transfers while paused", async function () {
    const { token, producer, alice } = await loadFixture(deployFixture);
    await token.pause();
    await expect(token.connect(producer).safeTransferFrom(producer, alice, ASSET, 10, "0x"))
      .to.be.revertedWithCustomError(token, "EnforcedPause");
  });
});

describe("Primary market", function () {
  it("sells shares at $10 with a 1% fee from the producer's proceeds", async function () {
    const { primary, token, usdc, alice, producer, treasury } = await loadFixture(deployFixture);
    await primary.connect(alice).buy(ASSET, 5); // $50
    expect(await token.balanceOf(alice, ASSET)).to.equal(5);
    expect(await usdc.balanceOf(alice)).to.equal(USDC(1_000_000 - 50));
    expect(await usdc.balanceOf(producer)).to.equal(USDC("49.5"));
    expect(await usdc.balanceOf(treasury)).to.equal(USDC("0.5"));
  });

  it("enforces the $50 minimum investment", async function () {
    const { primary, alice } = await loadFixture(deployFixture);
    await expect(primary.connect(alice).buy(ASSET, 4))
      .to.be.revertedWithCustomError(primary, "BelowMinimumInvestment");
  });

  it("cannot sell more than the offered 20%", async function () {
    const { primary, alice } = await loadFixture(deployFixture);
    await expect(primary.connect(alice).buy(ASSET, SHARES / 5n + 1n))
      .to.be.revertedWithCustomError(primary, "NotEnoughSharesOffered");
  });

  it("rejects buyers without KYC", async function () {
    const { primary, usdc, mallory } = await loadFixture(deployFixture);
    await usdc.mint(mallory, USDC(100));
    await usdc.connect(mallory).approve(primary, ethers.MaxUint256);
    await expect(primary.connect(mallory).buy(ASSET, 5)).to.be.reverted;
  });

  it("keeps the fee inside the 0.5%–1.5% band", async function () {
    const { primary } = await loadFixture(deployFixture);
    await expect(primary.setFee(49)).to.be.revertedWith("fee out of range");
    await expect(primary.setFee(151)).to.be.revertedWith("fee out of range");
    await primary.setFee(150);
    expect(await primary.feeBps()).to.equal(150);
  });
});

describe("Revenue distribution", function () {
  it("pays verified energy × tariff to holders pro-rata", async function () {
    const { primary, distributor, alice, bob, producer, produce } = await loadFixture(deployFixture);
    await primary.connect(alice).buy(ASSET, 10_000); // 1% of the asset
    await primary.connect(bob).buy(ASSET, 30_000); // 3%
    await produce(20_000); // 20 MWh × $0.05 = $1,000

    expect(await distributor.claimable(ASSET, alice)).to.equal(USDC(10));
    expect(await distributor.claimable(ASSET, bob)).to.equal(USDC(30));
    expect(await distributor.claimable(ASSET, producer)).to.equal(USDC(960));
  });

  it("keeper pushes payouts straight into holders' wallets", async function () {
    const { primary, distributor, usdc, platform, alice, bob, produce } = await loadFixture(deployFixture);
    await primary.connect(alice).buy(ASSET, 10_000);
    await primary.connect(bob).buy(ASSET, 10_000);
    await produce(20_000);
    const before = await usdc.balanceOf(alice);

    await expect(distributor.connect(platform).payout(ASSET, [alice, bob]))
      .to.emit(distributor, "RevenuePaid").withArgs(ASSET, alice.address, USDC(10));
    expect((await usdc.balanceOf(alice)) - before).to.equal(USDC(10));
    expect(await distributor.claimable(ASSET, alice)).to.equal(0);
  });

  it("past revenue stays with the seller; new revenue follows the shares", async function () {
    const { primary, token, distributor, alice, bob, produce } = await loadFixture(deployFixture);
    await primary.connect(alice).buy(ASSET, 10_000);
    await produce(20_000); // alice earns $10
    await token.connect(alice).safeTransferFrom(alice, bob, ASSET, 10_000, "0x");
    await produce(20_000); // now bob earns $10

    expect(await distributor.claimable(ASSET, alice)).to.equal(USDC(10));
    expect(await distributor.claimable(ASSET, bob)).to.equal(USDC(10));
  });

  it("cannot settle the same batch twice", async function () {
    const { distributor, platform, produce } = await loadFixture(deployFixture);
    const id = await produce(1_000);
    await expect(distributor.connect(platform).settle(id))
      .to.be.revertedWithCustomError(distributor, "AlreadySettled");
  });

  it("rejects overlapping production periods", async function () {
    const { oracle, platform } = await loadFixture(deployFixture);
    await oracle.connect(platform).recordBatch(ASSET, 1000, 4600, 1, HASH, 0, false);
    await expect(oracle.connect(platform).recordBatch(ASSET, 4000, 8000, 1, HASH, 0, false))
      .to.be.revertedWith("overlapping period");
  });

  it("only the platform oracle can anchor production data", async function () {
    const { oracle, mallory } = await loadFixture(deployFixture);
    await expect(oracle.connect(mallory).recordBatch(ASSET, 0, 3600, 1, HASH, 0, false))
      .to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
  });
});

describe("AI anomaly escrow + multisig", function () {
  async function flaggedFixture() {
    const f = await deployFixture();
    await f.primary.connect(f.alice).buy(ASSET, 10_000);
    const batchId = await f.produce(20_000, true); // AI flags this batch
    return { ...f, batchId };
  }

  it("holds revenue from AI-flagged batches in escrow", async function () {
    const { distributor, alice, batchId } = await loadFixture(flaggedFixture);
    expect(await distributor.claimable(ASSET, alice)).to.equal(0);
    expect(await distributor.totalEscrowed()).to.equal(USDC(1_000));
    expect((await distributor.settlements(batchId)).status).to.equal(2); // Escrowed
  });

  it("releases escrow to investors after 2 of 3 signers approve (false alarm)", async function () {
    const { distributor, multisig, s1, s2, alice, batchId } = await loadFixture(flaggedFixture);
    const data = distributor.interface.encodeFunctionData("releaseEscrow", [batchId]);
    await multisig.connect(s1).propose(distributor, 0, data, "False alarm: sensor recalibrated");
    expect(await distributor.claimable(ASSET, alice)).to.equal(0); // 1 of 2: not yet

    await expect(multisig.connect(s2).approve(0)).to.emit(multisig, "Executed").withArgs(0);
    expect(await distributor.claimable(ASSET, alice)).to.equal(USDC(10));
    expect(await distributor.totalEscrowed()).to.equal(0);
  });

  it("refunds the grid buyer when fraud is confirmed", async function () {
    const { distributor, multisig, usdc, offtaker, s1, s3, batchId } = await loadFixture(flaggedFixture);
    const before = await usdc.balanceOf(offtaker);
    const data = distributor.interface.encodeFunctionData("refundEscrow", [batchId]);
    await multisig.connect(s1).propose(distributor, 0, data, "Confirmed meter tampering");
    await multisig.connect(s3).approve(0);
    expect((await usdc.balanceOf(offtaker)) - before).to.equal(USDC(1_000));
  });

  it("no single key can move escrowed funds", async function () {
    const { distributor, admin, s1, multisig, batchId } = await loadFixture(flaggedFixture);
    await expect(distributor.connect(s1).releaseEscrow(batchId))
      .to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    await distributor.renounceRole(await distributor.ESCROW_ADMIN_ROLE(), admin);
    await expect(distributor.connect(admin).releaseEscrow(batchId))
      .to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    await expect(multisig.connect(s1).approve(0)).to.be.reverted; // no proposal yet
  });

  it("a signer cannot approve twice", async function () {
    const { distributor, multisig, s1, batchId } = await loadFixture(flaggedFixture);
    const data = distributor.interface.encodeFunctionData("releaseEscrow", [batchId]);
    await multisig.connect(s1).propose(distributor, 0, data, "release");
    await expect(multisig.connect(s1).approve(0)).to.be.revertedWithCustomError(multisig, "AlreadyApproved");
  });
});

describe("Secondary marketplace", function () {
  async function listedFixture() {
    const f = await deployFixture();
    await f.primary.connect(f.alice).buy(ASSET, 100);
    await f.token.connect(f.alice).setApprovalForAll(f.market, true);
    await f.market.connect(f.alice).list(ASSET, 100, USDC(11));
    return f;
  }

  it("trades listed shares with a 1% fee deducted from the seller", async function () {
    const { market, token, usdc, alice, bob, treasury } = await loadFixture(listedFixture);
    const aliceBefore = await usdc.balanceOf(alice);
    const treasuryBefore = await usdc.balanceOf(treasury);
    await market.connect(bob).buy(0, 40); // 40 × $11 = $440

    expect(await token.balanceOf(bob, ASSET)).to.equal(40);
    expect((await usdc.balanceOf(alice)) - aliceBefore).to.equal(USDC("435.6"));
    expect((await usdc.balanceOf(treasury)) - treasuryBefore).to.equal(USDC("4.4"));
    expect((await market.listings(0)).shares).to.equal(60);
  });

  it("seller keeps earning revenue on listed but unsold shares", async function () {
    const { distributor, alice, produce } = await loadFixture(listedFixture);
    await produce(1_000_000); // $50,000 over 1M shares; alice holds 100
    expect(await distributor.claimable(ASSET, alice)).to.equal(USDC(5));
  });

  it("only the seller can cancel, and cancelled listings cannot be bought", async function () {
    const { market, alice, bob } = await loadFixture(listedFixture);
    await expect(market.connect(bob).cancel(0)).to.be.revertedWithCustomError(market, "NotSeller");
    await market.connect(alice).cancel(0);
    await expect(market.connect(bob).buy(0, 1)).to.be.revertedWithCustomError(market, "ListingInactive");
  });
});
