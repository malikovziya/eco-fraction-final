require("@nomicfoundation/hardhat-toolbox");
const { vars } = require("hardhat/config");

// Well-known development mnemonic used by the local chain (anvil). Never use it on a public network.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

// Public testnet deploy (optional). Secrets live in Hardhat's config-variable store, not in this repo:
//   npx hardhat vars set AMOY_PRIVATE_KEY        (a fresh test wallet funded from a faucet)
//   npx hardhat vars set POLYGONSCAN_API_KEY     (optional: verifies source code on the explorer)
const amoyKey = vars.has("AMOY_PRIVATE_KEY") ? [vars.get("AMOY_PRIVATE_KEY")] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: { mnemonic: DEV_MNEMONIC, count: 10 },
    },
    amoy: {
      // Public Amoy endpoint (the official rpc-amoy.polygon.technology was not responding)
      url: vars.get("AMOY_RPC_URL", "https://polygon-amoy-bor-rpc.publicnode.com"),
      chainId: 80002,
      accounts: amoyKey,
    },
  },
  etherscan: {
    apiKey: vars.get("POLYGONSCAN_API_KEY", ""),
  },
  sourcify: { enabled: false },
};
