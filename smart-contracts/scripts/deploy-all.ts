/* eslint-disable no-console */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * One-shot deploy of the full platform to the selected network.
 * Writes a JSON manifest to deployments/<network>.json.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.INITIAL_OWNER ?? deployer.address;
  const platformFeeBps = BigInt(process.env.PLATFORM_FEE_BPS ?? "200");
  const creatorFeeBps  = BigInt(process.env.CREATOR_FEE_BPS  ?? "100");
  const treasuryFeeBps = BigInt(process.env.TREASURY_FEE_BPS ?? "50");
  const gradThreshold  = BigInt(process.env.GRADUATION_THRESHOLD_WAD ?? "69000000000000000000000");

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  // 1. RialToken
  const RialToken = await ethers.getContractFactory("RialToken");
  const rial = await RialToken.deploy(admin);
  await rial.waitForDeployment();
  console.log("RialToken         :", await rial.getAddress());

  // 2. Treasury
  const Treasury = await ethers.getContractFactory("RialTreasury");
  const treasury = await Treasury.deploy(admin);
  await treasury.waitForDeployment();
  console.log("RialTreasury      :", await treasury.getAddress());

  // 3. Vesting
  const Vesting = await ethers.getContractFactory("VestingWallet");
  const vesting = await Vesting.deploy(admin);
  await vesting.waitForDeployment();
  console.log("VestingWallet     :", await vesting.getAddress());

  // 4. Router + factory wiring. RialRouter immutably derives CREATE2 pair
  // addresses from the real LaunchpadFactory, so predict the factory address
  // from the deployer's next CREATE nonce before deploying the router.
  const deploymentNonce = await deployer.getNonce("pending");
  const predictedFactory = ethers.getCreateAddress({ from: deployer.address, nonce: deploymentNonce + 4 });
  const Router = await ethers.getContractFactory("RialRouter");
  const router = await Router.deploy(predictedFactory, await treasury.getAddress());
  await router.waitForDeployment();
  console.log("RialRouter        :", await router.getAddress());

  // 5. LaunchpadFactory
  const Factory = await ethers.getContractFactory("LaunchpadFactory");
  const factory = await Factory.deploy(
    admin,
    await rial.getAddress(),
    await treasury.getAddress(),
    await router.getAddress(),
    await vesting.getAddress(),
    platformFeeBps,
    creatorFeeBps
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  if (factoryAddress.toLowerCase() !== predictedFactory.toLowerCase()) {
    throw new Error(`factory address prediction mismatch: expected ${predictedFactory}, got ${factoryAddress}`);
  }
  console.log("LaunchpadFactory  :", factoryAddress);

  // 6. Timelock (optional admin wrapper; can be wired in later via role transfers)
  const Timelock = await ethers.getContractFactory("Timelock");
  const timelock = await Timelock.deploy(admin, 24 * 60 * 60);
  await timelock.waitForDeployment();
  console.log("Timelock          :", await timelock.getAddress());

  const manifest = {
    network: network.name,
    chainId: Number(network.config.chainId ?? 0),
    deployer: deployer.address,
    admin,
    contracts: {
      RialToken:        await rial.getAddress(),
      RialTreasury:     await treasury.getAddress(),
      VestingWallet:    await vesting.getAddress(),
      RialRouter:       await router.getAddress(),
      LaunchpadFactory: factoryAddress,
      Timelock:         await timelock.getAddress(),
    },
    config: {
      platformFeeBps: platformFeeBps.toString(),
      creatorFeeBps:  creatorFeeBps.toString(),
      treasuryFeeBps: treasuryFeeBps.toString(),
      graduationThreshold: gradThreshold.toString(),
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log("Wrote manifest to", outFile);
}

main().catch((err) => { console.error(err); process.exit(1); });
