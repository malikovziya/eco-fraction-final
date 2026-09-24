require("@nomicfoundation/hardhat-toolbox");

// Well-known development mnemonic used by the local chain (anvil). Never use it on a public network.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

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
  },
};
