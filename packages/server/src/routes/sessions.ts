import { Router } from "express";
import { z } from "zod";
import { addSpend, endSession, getSession, openYellowSession } from "../yellow";
import { ethers } from "ethers";
import { ENV } from "../env";

// Minimal ABI for SessionVault
const VAULT_ABI = [
  "function openSession(bytes32 id,address user,address merchant,uint256 allowance) external",
  "function accountOffchainSpend(bytes32 id,uint256 newTotalSpent) external",
  "function settle(bytes32 id) external"
];

export function sessionRouter() {
  const r = Router();
  const provider = new ethers.JsonRpcProvider(ENV.RPC_URL);
  const wallet = new ethers.Wallet(ENV.PRIVATE_KEY, provider);
  const vault = new ethers.Contract(ENV.SESSION_VAULT, VAULT_ABI, wallet);

  r.post("/open", async (req, res) => {
    try {
      const schema = z.object({
        sessionId: z.string(),
        user: z.string(),
        merchant: z.string().default(ENV.MERCHANT_ADDRESS),
        allowance: z.string() // in wei
      });
      const body = schema.parse(req.body);
      openYellowSession(body.sessionId, body.user, body.merchant, BigInt(body.allowance));
      const tx = await vault.openSession(ethers.id(body.sessionId), body.user, body.merchant, body.allowance);
      await tx.wait();
      res.json({ ok: true, txHash: tx.hash });
    } catch (e:any) { res.status(400).json({ ok:false, error: e.message }); }
  });

  r.post("/spend", async (req, res) => {
    try {
      const schema = z.object({ sessionId: z.string(), delta: z.string() });
      const { sessionId, delta } = schema.parse(req.body);
      const s = addSpend(sessionId, BigInt(delta));
      const tx = await vault.accountOffchainSpend(ethers.id(sessionId), s.spent.toString());
      await tx.wait();
      res.json({ ok: true, newTotal: s.spent.toString(), txHash: tx.hash });
    } catch (e:any) { res.status(400).json({ ok:false, error: e.message }); }
  });

  r.post("/settle", async (req, res) => {
    try {
      const schema = z.object({ sessionId: z.string() });
      const { sessionId } = schema.parse(req.body);
      const s = endSession(sessionId);
      const tx = await vault.settle(ethers.id(sessionId));
      await tx.wait();
      res.json({ ok: true, paid: s.spent.toString(), txHash: tx.hash });
    } catch (e:any) { res.status(400).json({ ok:false, error: e.message }); }
  });

  r.get("/:id", (req,res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ ok:false, error: "not found" });
    res.json({ ok:true, session: { ...s, allowance: s.allowance.toString(), spent: s.spent.toString() }});
  });

  return r;
}
