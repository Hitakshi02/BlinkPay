export const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT!;
export const PYUSD = process.env.NEXT_PUBLIC_PYUSD!;
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL!;

export const VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function openSession(bytes32 id,address user,address merchant,uint256 allowance) external",
  "function accountOffchainSpend(bytes32 id,uint256 newTotalSpent) external",
  "function settle(bytes32 id) external"
];
export const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];
