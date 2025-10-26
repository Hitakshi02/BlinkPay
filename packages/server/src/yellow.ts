// apps/web/src/lib/yellow.ts
// Minimal Nitrolite client: connect, open session, debit instantly, close.

// Lightweight local shim for the small subset of nitrolite API used by this file.
// This avoids the compile error when the external package or its types are missing.
async function createAppSessionMessage(
  messageSigner: (msg: string) => Promise<string>,
  apps: any[]
): Promise<string> {
  const payload = { apps, timestamp: Date.now() };
  const signature = await messageSigner(JSON.stringify(payload));
  return JSON.stringify({ type: "session_open", payload, signature });
}

function parseRPCResponse(data: any): any {
  try {
    if (typeof data === "string") return JSON.parse(data);
    return data;
  } catch {
    return null;
  }
}

export type YellowSession = {
  ws: WebSocket;
  user: string;
  partner: string;
  id?: string; // assigned by ClearNode on 'session_created'
  ready: Promise<void>;
};

// Connect to the Yellow ClearNode (Nitrolite RPC over WebSocket)
export function connectYellow(): WebSocket {
  // You can move this URL to NEXT_PUBLIC_YELLOW_WS if needed
  const ws = new WebSocket("wss://clearnet.yellow.com/ws");
  return ws;
}

// Set up a signer using MetaMask (personal_sign), as per docs
export async function getMessageSigner() {
  if (!(globalThis as any).ethereum) throw new Error("Please install MetaMask");
  const accounts: string[] = await (globalThis as any).ethereum.request({
    method: "eth_requestAccounts",
  });
  const user = accounts[0];
  const messageSigner = async (message: string) => {
    return await (globalThis as any).ethereum.request({
      method: "personal_sign",
      params: [message, user],
    });
  };
  return { user, messageSigner };
}

// Open a payment session between user and partner (merchant)
export async function openYellowSession(
  partner: string
): Promise<YellowSession> {
  const ws = connectYellow();
  const { user, messageSigner } = await getMessageSigner();

  // Wait for WS to be open
  const ready = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
  });
  await ready;

  // Define a basic payment app per docs
  const appDefinition = {
    protocol: "payment-app-v1",
    participants: [user, partner],
    weights: [50, 50],
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
  };

  // Initial off-chain allocations; use 6-dec units like PYUSD (name is app-level)
  const allocations = [
    { participant: user, asset: "pyusd", amount: "0" }, // user starts at 0 spent
    { participant: partner, asset: "pyusd", amount: "0" },
  ];

  const sessionMessage = await createAppSessionMessage(
    messageSigner,
    [{ definition: appDefinition, allocations }],
  );

  // Handle ClearNode responses
  const session: YellowSession = { ws, user, partner, ready };

  ws.onmessage = (event) => {
    const msg = parseRPCResponse(event.data);
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "session_created":
        session.id = msg.sessionId; // ClearNode’s session id (optional for display)
        break;
      case "payment":
        // Incoming payment from partner (not used in our demo)
        break;
      case "error":
        console.error("[Yellow] error:", msg.error);
        break;
    }
  };

  // Send the session open message
  ws.send(sessionMessage);

  return session;
}

// Send an instant off-chain debit (tip/spend). We update app state immediately.
export async function yellowDebit(sess: YellowSession, amountBaseUnits: bigint) {
  const paymentData = {
    type: "payment",
    amount: amountBaseUnits.toString(),
    recipient: sess.partner,
    timestamp: Date.now(),
  };

  // Sign payload using MetaMask personal_sign (stringified)
  const signature = await (globalThis as any).ethereum.request({
    method: "personal_sign",
    params: [JSON.stringify(paymentData), sess.user],
  });

  const signedPayment = {
    ...paymentData,
    signature,
    sender: sess.user,
  };

  sess.ws.send(JSON.stringify(signedPayment));
}

// Close the WS (end Yellow session)
export function closeYellow(sess?: YellowSession) {
  try {
    sess?.ws?.close();
  } catch {}
}
