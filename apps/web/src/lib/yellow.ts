// apps/web/src/lib/yellow.ts
"use client";

/**
 * Minimal Yellow/Nitrolite-style client:
 * - Opens a WS to the ClearNode
 * - "Opens a session" by sending a signed JSON payload
 * - Sends signed "payment" messages (off-chain debits)
 * - Tracks a local running total for instant UX
 *
 * NOTE: We intentionally avoid importing any SDK types to keep this file
 * drop-in and error-free in strict TS Next apps.
 */

type EthLike = {
  request: (args: { method: string; params?: any[] }) => Promise<any>;
};

declare global {
  interface Window {
    ethereum?: EthLike;
  }
}

export type YellowSession = {
  ws: WebSocket;
  user: string;
  merchant: string;
  id?: string;       // optional, if the node replies with a session id
  total: bigint;     // local running total (base units, 6 dp for PYUSD)
  ready: Promise<void>;
};

/** Internal: open a WebSocket and return a "ready" promise */
function openSocket(url: string) {
  const ws = new WebSocket(url);
  const ready = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Yellow WS connection failed"));
  });
  ws.onclose = (ev) => {
    console.warn("[Yellow] closed:", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
  };
  return { ws, ready };
}

/** Internal: get MetaMask account + signer (personal_sign) */
async function getSigner() {
  const eth = window.ethereum;
  if (!eth) throw new Error("Install / unlock MetaMask");
  const [addr] = await eth.request({ method: "eth_requestAccounts" });
  const sign = (msg: string) =>
    eth.request({ method: "personal_sign", params: [msg, addr] }) as Promise<string>;
  return { addr, sign, eth };
}

/**
 * Open an off-chain "session" with the merchant.
 * This sends a signed JSON payload over WS that your demo can log/verify.
 * (Final value still settles on-chain via your SessionVault.)
 */
export async function yellowOpenSession(merchant: string): Promise<YellowSession> {
  const url = process.env.NEXT_PUBLIC_YELLOW_WS || "wss://clearnet.yellow.com/ws";
  const { ws, ready } = openSocket(url);
  await ready;

  const { addr: user, sign } = await getSigner();

  // Compose a minimal session-open message
  const payload = {
    type: "open_session",
    protocol: "payment-app-v1",
    participants: [user, merchant],
    asset: "pyusd",
    nonce: Date.now(),
    ts: Date.now(),
  };

  const signature = await sign(JSON.stringify(payload));
  const message = { ...payload, sender: user, signature };

  // Basic handlers (non-fatal if node sends plain text)
  // initial handler is a no-op; a more specific message listener is attached below
  ws.onmessage = () => {
    /* noop */
  };

  ws.send(JSON.stringify(message));

  const sess: YellowSession = { ws, user, merchant, total: BigInt(0), ready };

  // If node later sends a JSON { type: "session_created", sessionId: "..." }
  ws.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(String(ev.data));
      if (data?.type === "session_created" && typeof data.sessionId === "string") {
        sess.id = data.sessionId;
        console.info("[Yellow] session_created:", data.sessionId);
      } else if (data?.type === "payment_ack") {
        console.info("[Yellow] payment_ack:", data);
      }
    } catch {
      // ignore non-JSON frames
    }
  });

  return sess;
}

/**
 * Send a signed off-chain "payment" (tip/debit) for `delta` base units.
 * We optimistically bump the local total for instant UX.
 */
export async function yellowSendPayment(sess: YellowSession, delta: bigint) {
  sess.total += delta; // optimistic update for instant meter

  const { user, merchant } = sess;
  const payload = {
    type: "payment",
    sender: user,
    recipient: merchant,
    asset: "pyusd",
    amount: delta.toString(), // base units (e.g., 50000 = 0.05 PYUSD at 6 dp)
    ts: Date.now(),
  };

  const eth = window.ethereum!;
  const signature = (await eth.request({
    method: "personal_sign",
    params: [JSON.stringify(payload), user],
  })) as string;

  const signedPayment = { ...payload, signature };
  sess.ws.send(JSON.stringify(signedPayment));

  return sess.total;
}

/** Close the Yellow socket (UI-level cleanup) */
export function yellowClose(sess?: YellowSession) {
  try {
    sess?.ws?.close();
  } catch {
    /* noop */
  }
}
