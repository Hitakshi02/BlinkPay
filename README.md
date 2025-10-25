## BlinkPay – current status (v0.1.0)

- Contracts: `SessionVault` V2 deployed to Sepolia (constructor: PYUSD), supports `deposit`, `openSession`, `accountOffchainSpend`, `settle`.
- Server: Express API on port 4000 with `/health` and `/sessions/*` (CORS enabled).
- Web: Next.js scaffolding; CSP allows connect to localhost:4000.

### Quick start
```bash
# contracts
cd packages/contracts
cp .env.example .env    # fill RPC_URL, PRIVATE_KEY, PYUSD
npx hardhat compile
npx hardhat run scripts/deploy.ts --network sepolia
# copy address to server/.env and web/.env.local

# server
cd ../server
cp .env.example .env    # fill all vars, MOCK_ONCHAIN=false
npm i
npm run dev

# web
cd ../../apps/web
cp .env.local.example .env.local
npm i
npm run dev
