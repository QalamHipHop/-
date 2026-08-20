import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const privateKey = process.env.PRIVATE_KEY?.trim();
const isValidPrivateKey = !!privateKey && /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey) && !/^0x?0{64}$/i.test(privateKey);
if (privateKey && !isValidPrivateKey) {
  throw new Error("PRIVATE_KEY must be a non-zero 32-byte hex key");
}

const networks: HardhatUserConfig["networks"] = {
  hardhat: { chainId: 31337 },
  localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
};

if (process.env.SEPOLIA_RPC_URL && isValidPrivateKey) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [privateKey!],
    chainId: 11155111,
  };
}

if (process.env.RIAL_RPC_URL) {
  if (!isValidPrivateKey) {
    throw new Error("RIAL_RPC_URL requires a valid non-zero PRIVATE_KEY");
  }
  const chainId = Number(process.env.RIAL_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("RIAL_CHAIN_ID must be a positive integer when RIAL_RPC_URL is configured");
  }
  networks.rial = { url: process.env.RIAL_RPC_URL, accounts: [privateKey!], chainId };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
    },
  },
  networks,
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};

export default config;
