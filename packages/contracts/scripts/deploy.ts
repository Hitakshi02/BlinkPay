import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
  const F = await ethers.getContractFactory("SessionVault");
  const pyusd = process.env.PYUSD;
  if (!pyusd) {
    throw new Error("Missing PYUSDenvironment variable");
  }
  const vault = await F.deploy(pyusd);
  await vault.waitForDeployment();
  console.log("SessionVault:", await vault.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });
