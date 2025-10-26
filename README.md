# 🎥 BlinkStream

**BlinkStream** is a pay-per-minute livestream and tipping platform powered by **PayPal PYUSD**, **Yellow SDK**, and **Blockscout MCP**.  
It allows viewers to deposit once and interact instantly — sending micro-tips or paying per minute without repeated wallet pop-ups — and then settles on-chain once at the end of the session.

---

## 💡 Problem

Creators face:
- Failed or delayed on-chain micro-transactions  
- Constant wallet pop-ups ruining live UX  
- No simple way to summarize on-chain payments  

---

## ⚙️ Solution

BlinkStream fixes this using:

### 🔶 Yellow SDK – Off-Chain Session Metering
- Opens a secure session with a **PYUSD allowance** (e.g. 2 PYUSD).  
- Enables **instant tips** and **per-minute unlocks** off-chain (< 50 ms).  

### 💰 PayPal PYUSD – Stable On-Chain Settlement
- All tips use **PYUSD** for predictable value.  
- One on-chain transaction at the end:
  - Merchant receives earnings  
  - Viewer automatically gets any refund  

### 🔍 Blockscout MCP – AI-Readable Receipt
- After settlement, MCP summarizes the on-chain transaction in natural language.  
- Judges can query MCP to verify and explain any tx or session.

---

## 🧩 Demo Flow

1. **Start Session** → Approve PYUSD allowance via Yellow  
2. **Tip / Stream** → Instant off-chain meter updates  
3. **End & Settle** → Single on-chain payout  
4. **Generate Receipt** → AI summary via Blockscout MCP  

---
Key variables:

BLOCKSCOUT_MCP_URL=https://mcp.blockscout.com/mcp
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CHAIN=sepolia

**Run the Project**
pnpm dev:server   # start backend on :4000
pnpm dev:web      # start frontend on :3000

**Test the Flow
**
Open http://localhost:3000

Click Start Session → approve allowance

Click Tip +0.05 / +0.10

Click End & Settle → view tx on Blockscout

Click Generate Receipt → see MCP summary

