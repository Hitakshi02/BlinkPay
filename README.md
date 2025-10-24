# BlinkPay — PYUSD Session Payments

Instant, session-based micro-payments with PYUSD. Off-chain metering via Yellow, on-chain settlement via SessionVault.

## Quick Start
1) Contracts
```bash
cd packages/contracts
cp .env.example .env   # fill RPC_URL, PRIVATE_KEY, PYUSD
npm i
npx hardhat compile
npx hardhat run scripts/deploy.ts --network sepolia
