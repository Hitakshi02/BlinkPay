import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const pyusd = process.env.PYUSD!;
  if (!pyusd) throw new Error("PYUSD not set");
  const Vault = await ethers.getContractFactory("SessionVault");
  const vault = await Vault.deploy(pyusd);
  await vault.deployed();
  console.log("SessionVault deployed to:", vault.address);
}
main().catch((e) => { console.error(e); process.exit(1); });
