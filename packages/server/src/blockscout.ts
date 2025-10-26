// packages/server/src/blockscout.ts
export type ExplainMeta = {
  txHash: string;
  explorerUrl?: string;
  from?: string;
  to?: string;
  status?: string;
  value?: string | number;
  transfers?: Array<{ amount?: string; symbol?: string; from?: string; to?: string }>;
};

type ExplainResult =
  | { ok: true; text: string; meta?: ExplainMeta; pending?: boolean }
  | { ok: false; error: string };

const REST_BASE = process.env.BLOCKSCOUT_API_BASE || "https://eth-sepolia.blockscout.com";

export async function fetchTxMeta(txHash: string): Promise<ExplainResult> {
  try {
    const txRes = await fetch(`${REST_BASE}/api/v2/transactions/${txHash}`);
    if (txRes.status === 404) return { ok: true, pending: true, text: "Explorer still indexing.", meta: { txHash } };
    if (!txRes.ok) return { ok: false, error: `REST tx HTTP ${txRes.status}` };
    const tx: any = await txRes.json();

    let transfers: ExplainMeta["transfers"] = [];
    try {
      const tRes = await fetch(`${REST_BASE}/api/v2/transactions/${txHash}/token-transfers`);
      if (tRes.ok) {
        const tJson = await tRes.json();
        const items = Array.isArray((tJson as any)?.items) ? (tJson as any).items : tJson as any;
        if (Array.isArray(items)) {
          transfers = items.slice(0, 10).map((t: any) => ({
            amount: t.total?.value ?? t.value ?? t.amount ?? "",
            symbol: t.token?.symbol ?? t.symbol ?? "",
            from: t.from?.hash ?? t.from ?? "",
            to: t.to?.hash ?? t.to ?? "",
          }));
        }
      }
    } catch {}

    const meta: ExplainMeta = {
      txHash,
      explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      from: tx?.from?.hash ?? tx?.from ?? "",
      to: tx?.to?.hash ?? tx?.to ?? "",
      status: (tx?.status ?? tx?.successful ?? tx?.result ?? "unknown") + "",
      value: tx?.value ?? 0,
      transfers,
    };

    const base =
      `Transaction ${txHash}\n` +
      `Status: ${meta.status}\nFrom: ${meta.from}\nTo: ${meta.to}\nNative value: ${meta.value}\n`;
    const transfersText = (transfers?.length
      ? "\nToken Transfers:\n" + transfers.map(t => `- ${t.amount} ${t.symbol} from ${t.from} to ${t.to}`).join("\n")
      : "");

    return { ok: true, text: base + transfersText, meta };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
