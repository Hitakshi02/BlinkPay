import { Router } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { ENV } from '../env';

// ---- In-memory Yellow-like session store ----
type Session = {
  id: string;
  user: string;
  merchant: string;
  allowance: bigint;
  spent: bigint;
  open: boolean;
};
const sessions: Map<string, Session> = new Map();

function openYellowSession(id: string, user: string, merchant: string, allowance: bigint) {
  sessions.set(id, { id, user, merchant, allowance, spent: 0n, open: true });
}
function addSpend(id: string, delta: bigint) {
  const s = sessions.get(id);
  if (!s) throw new Error('session not found');
  if (!s.open) throw new Error('session closed');
  s.spent += delta;
  return s;
}
function endSession(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error('session not found');
  s.open = false;
  return s;
}
function getSession(id: string) {
  return sessions.get(id);
}

// ---- Minimal ABI for SessionVault ----
const VAULT_ABI = [
  'function openSession(bytes32 id,address user,address merchant,uint256 allowance) external',
  'function accountOffchainSpend(bytes32 id,uint256 newTotalSpent) external',
  'function settle(bytes32 id) external'
];

const provider = new ethers.JsonRpcProvider(ENV.RPC_URL);
const wallet = new ethers.Wallet(ENV.PRIVATE_KEY, provider);
const vault = new ethers.Contract(ENV.SESSION_VAULT, VAULT_ABI, wallet);

const router = Router();

// POST /sessions/open
router.post('/open', async (req, res) => {
  try {
    const schema = z.object({
      sessionId: z.string().min(1),
      user: z.string().min(1),
      merchant: z.string().default(ENV.MERCHANT_ADDRESS),
      allowance: z.string().regex(/^\d+$/) // wei as string
    });
    const body = schema.parse(req.body);

    openYellowSession(body.sessionId, body.user, body.merchant, BigInt(body.allowance));
    const tx = await vault.openSession(
      ethers.id(body.sessionId), // bytes32
      body.user,
      body.merchant,
      body.allowance
    );
    await tx.wait();
    res.json({ ok: true, txHash: tx.hash });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message ?? String(e) });
  }
});

// POST /sessions/spend
router.post('/spend', async (req, res) => {
  try {
    const schema = z.object({
      sessionId: z.string().min(1),
      delta: z.string().regex(/^\d+$/) // wei as string
    });
    const { sessionId, delta } = schema.parse(req.body);

    const s = addSpend(sessionId, BigInt(delta));
    const tx = await vault.accountOffchainSpend(ethers.id(sessionId), s.spent.toString());
    await tx.wait();

    res.json({ ok: true, newTotal: s.spent.toString(), txHash: tx.hash });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message ?? String(e) });
  }
});

// POST /sessions/settle
router.post('/settle', async (req, res) => {
  try {
    const schema = z.object({ sessionId: z.string().min(1) });
    const { sessionId } = schema.parse(req.body);

    const s = endSession(sessionId);
    const tx = await vault.settle(ethers.id(sessionId));
    await tx.wait();

    res.json({ ok: true, paid: s.spent.toString(), txHash: tx.hash });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message ?? String(e) });
  }
});

// GET /sessions/:id
router.get('/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({
    ok: true,
    session: {
      ...s,
      allowance: s.allowance.toString(),
      spent: s.spent.toString()
    }
  });
});

export default router;
