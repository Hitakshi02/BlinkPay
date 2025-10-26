import { Router } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { ENV } from "../env";
import { fetchTxMeta } from "../blockscout";
import { summarizeReceipt } from "../llm";

const MAX_TIPS_PER_10S = Number(process.env.RISK_MAX_TIPS_PER_10S || 5);

// ---- Session store ----
type TipEvent = { ts: number; amt: bigint };
type Session = {
  id: string;
  user: string;
  merchant: string;
  allowance: bigint;
  spent: bigint;
  open: boolean;
  settleTx?: string;
  tips?: TipEvent[];
  aiText?: string;
  aiUpdatedAt?: number;
};
const sessions: Map<string, Session> = new Map();

function openYellowSession(id: string, user: string, merchant: string, allowance: bigint) {
  sessions.set(id, { id, user, merchant, allowance, spent: 0n, open: true, tips: [] });
}
function addSpend(id: string, delta: bigint) {
  const s = sessions.get(id);
  if (!s) throw new Error("session not found");
  if (!s.open) throw new Error("session closed");
  const now = Date.now();
  // velocity window
  s.tips = (s.tips || []).filter(ev => now - ev.ts <= 10_000);
  if ((s.tips || []).length >= MAX_TIPS_PER_10S) {
    const wait = Math.ceil((10_000 - (now - (s.tips![0].ts))) / 1000);
    const err = new Error(`RATE_LIMIT: too many tips; retry in ~${wait}s`);
    (err as any).code = "RATE_LIMIT";
    throw err;
  }
  const newTotal = s.spent + delta;
  if (newTotal > s.allowance) throw new Error("exceeds allowance");
  s.spent = newTotal;
  s.tips!.push({ ts: now, amt: delta });
  return s;
}
function endSession(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("session not found");
  if (!s.open) throw new Error("closed");
  s.open = false;
  return s;
}
function getSession(id: string) {
  return sessions.get(id);
}
function fmt(s: Session) {
  return {
    ...s,
    allowance: s.allowance.toString(),
    spent: s.spent.toString(),
    settleTx: s.settleTx,
  };
}

// ---- SessionVault ABI ----
const VAULT_ABI = [
  "function openSession(bytes32 id,address user,address merchant,uint256 allowance) external",
  "function accountOffchainSpend(bytes32 id,uint256 newTotalSpent) external",
  "function settle(bytes32 id) external",
];
const provider = new ethers.JsonRpcProvider(ENV.RPC_URL);
const wallet = new ethers.Wallet(ENV.PRIVATE_KEY, provider);
const vault = new ethers.Contract(ENV.SESSION_VAULT, VAULT_ABI, wallet);

const router = Router();

// -------------------- POSTs --------------------
router.post("/open", async (req, res) => {
  try {
    const schema = z.object({
      sessionId: z.string().min(1),
      user: z.string().min(1),
      merchant: z.string().default(ENV.MERCHANT_ADDRESS),
      allowance: z.string().regex(/^\d+$/),
    });
    const body = schema.parse(req.body);

    const existing = sessions.get(body.sessionId);
    if (existing && existing.open) {
      return res.status(409).json({
        ok: false,
        error: "SESSION_EXISTS_OPEN",
        hint: "Generate a new sessionId or end & settle the existing session first.",
      });
    }
    if (existing && !existing.open) sessions.delete(body.sessionId);

    openYellowSession(body.sessionId, body.user, body.merchant, BigInt(body.allowance));

    const tx = await vault.openSession(ethers.id(body.sessionId), body.user, body.merchant, body.allowance);
    await tx.wait();
    res.json({ ok: true, txHash: tx.hash });
  } catch (e: any) {
    const msg = String(e?.reason || e?.message || e);
    if (msg.includes("deposit<allowance")) {
      return res.status(400).json({
        ok: false,
        error: "DEPOSIT_LESS_THAN_ALLOWANCE",
        hint: "Deposit more PYUSD to the SessionVault or lower the requested allowance.",
      });
    }
    res.status(400).json({ ok: false, error: msg });
  }
});

router.post("/spend", async (req, res) => {
  try {
    const schema = z.object({ sessionId: z.string().min(1), delta: z.string().regex(/^\d+$/) });
    const { sessionId, delta } = schema.parse(req.body);

    const s = addSpend(sessionId, BigInt(delta));
    const tx = await vault.accountOffchainSpend(ethers.id(sessionId), s.spent.toString());
    await tx.wait();
    res.json({ ok: true, newTotal: s.spent.toString(), txHash: tx.hash });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if ((e as any).code === "RATE_LIMIT") {
      return res.status(429).json({ ok: false, error: msg });
    }
    res.status(400).json({ ok: false, error: msg });
  }
});

router.post("/settle", async (req, res) => {
  try {
    const schema = z.object({ sessionId: z.string().min(1) });
    const { sessionId } = schema.parse(req.body);

    const s = endSession(sessionId);
    const tx = await vault.settle(ethers.id(sessionId));
    await tx.wait();

    s.settleTx = tx.hash;
    // clear prior AI cache on new settlement
    s.aiText = undefined;
    s.aiUpdatedAt = undefined;

    res.json({ ok: true, paid: s.spent.toString(), txHash: tx.hash });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// -------------------- GETs --------------------
router.get("/list", (_req, res) => {
  const list = Array.from(sessions.values()).map(fmt).reverse();
  res.json({ ok: true, sessions: list });
});

router.get("/tx/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "not found" });
  if (!s.settleTx) return res.status(404).json({ ok: false, error: "no settle tx" });
  res.json({ ok: true, txHash: s.settleTx });
});

router.get("/receipt/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "not found" });
  const paid = s.spent;
  const refund = s.allowance > s.spent ? s.allowance - s.spent : 0n;
  const text = `Paid ${(Number(paid) / 1_000_000).toFixed(6)} PYUSD to ${s.merchant} for session ${s.id}. Refund ${(Number(refund) / 1_000_000).toFixed(6)} back to ${s.user}.`;
  res.json({ ok: true, receipt: { id: s.id, user: s.user, merchant: s.merchant, paid: paid.toString(), refund: refund.toString(), text } });
});

// AI receipt (cache + REST + LLM)
router.get("/receipt-ai/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ ok: false, error: "not found" });
    if (!s.settleTx) {
      return res.status(200).json({
        ok: true,
        pending: true,
        text: "No settlement tx recorded yet for this session. Settle first, then try again."
      });
    }

    const ai = await summarizeReceipt({
      txHash: s.settleTx,
      sessionId: s.id,
      user: s.user,
      merchant: s.merchant,
      paid: s.spent.toString(),
      refund: (s.allowance > s.spent ? s.allowance - s.spent : 0n).toString(),
      // optionally pass your billing config if you have it stored:
      // mode: "per-minute",
      // rate: 0.05,
    });

    // Always 200 with payload describing state (ok/pending/error)
    res.json(ai);
  } catch (e: any) {
    res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
});

// ---- DEV helpers ----
router.post("/reset", (_req, res) => {
  sessions.clear();
  res.json({ ok: true, cleared: true });
});
router.delete("/delete/:id", (req, res) => {
  const existed = sessions.delete(req.params.id);
  res.json({ ok: true, deleted: existed });
});

export default router;
