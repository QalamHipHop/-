import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x" + "0".repeat(64);
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";
const ETHERSCAN = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: { url: SEPOLIA_RPC, accounts: [PRIVATE_KEY], chainId: 11155111 },
  },
  etherscan: { apiKey: ETHERSCAN },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};

export default config;
