// packages/server/src/llm.ts
import { ENV } from "./env";

type SummarizeResult =
  | { ok: true; text: string }
  | { ok: false; error: string }
  | { ok: true; pending: true; text: string };

function fetchWithTimeout(url: string, init: RequestInit, ms = 12_000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(id));
}

async function safeJson(res: Response) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

/**
 * Summarize a settlement using (priority):
 *  1) Blockscout MCP (multichain, analysis-ready)
 *  2) OpenAI (fallback if MCP not configured or fails)
 *  3) Plain-text fallback (never blocks the demo)
 */
export async function summarizeReceipt(facts: {
  txHash?: string;                // settlement tx hash (if known)
  sessionId: string;
  user: string;
  merchant: string;
  paid: string;                   // base units (6dp)
  refund: string;                 // base units (6dp)
  mode?: "per-minute" | "per-hour" | "per-session";
  rate?: number;                  // PYUSD float, optional
}): Promise<SummarizeResult> {
  const paidPY = Number(facts.paid) / 1_000_000;
  const refundPY = Number(facts.refund) / 1_000_000;

  const prompt =
    [
      "You are a concise blockchain payments explainer for a tipping session.",
      "Return 2–4 short bullets in plain English for a receipt.",
      "Mention PYUSD amounts (2 decimals ok), merchant, and session id.",
      "If there is a billing mode/rate, include it briefly.",
      "",
      `Tx: ${facts.txHash ?? "N/A"}`,
      `Session: ${facts.sessionId}`,
      `User: ${facts.user}`,
      `Merchant: ${facts.merchant}`,
      `Paid (PYUSD): ${paidPY.toFixed(2)} (${facts.paid} base units, 6dp)`,
      `Refund (PYUSD): ${refundPY.toFixed(2)} (${facts.refund} base units, 6dp)`,
      facts.mode ? `Billing: ${facts.mode}${facts.rate ? ` @ ${facts.rate}/unit` : ""}` : "Billing: N/A",
    ].join("\n");

  const fallbackSummary =
    `• Session ${facts.sessionId}: paid ${paidPY.toFixed(2)} PYUSD to ${facts.merchant}.` +
    (refundPY > 0 ? ` • Refund ${refundPY.toFixed(2)} PYUSD to ${facts.user}.` : "") +
    (facts.mode ? ` • Billing: ${facts.mode}${facts.rate ? ` @ ${facts.rate}` : ""}.` : "");

  // ---------- 1) Blockscout MCP (primary) ----------
  if ((ENV as any).BLOCKSCOUT_MCP_URL) {
    try {
      const res = await fetchWithTimeout(`${(ENV as any).BLOCKSCOUT_MCP_URL.replace(/\/+$/,'')}/query`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...((ENV as any).BLOCKSCOUT_MCP_API_KEY ? { authorization: `Bearer ${(ENV as any).BLOCKSCOUT_MCP_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          // Keep it simple: feed the prompt; many MCP setups accept {prompt}
          prompt
        }),
      }, 12_000);

      if (!res.ok) {
        const body = await safeJson(res);
        // If explorer still indexing, return a "pending" hint to UI
        if (res.status === 404 || res.status === 425) {
          return { ok: true, pending: true, text: "Explorer is indexing this transaction. Please retry shortly." };
        }
        return { ok: false, error: `MCP HTTP ${res.status}${typeof body === "string" ? "" : body?.error ? `: ${body.error}` : ""}` };
      }

      const j: any = await safeJson(res);
      const text =
        j?.text ??
        j?.result ??
        j?.message ??
        (typeof j === "string" ? j : "");

      if (text && typeof text === "string") {
        return { ok: true, text };
      }

      // Unexpected shape: degrade gracefully
      return { ok: true, text: fallbackSummary };
    } catch (e: any) {
      // Network/timeout → try OpenAI next
    }
  }

  // ---------- 2) OpenAI fallback ----------
  if (ENV.OPENAI_API_KEY) {
    try {
      const model = ENV.OPENAI_MODEL || "gpt-4o-mini";
      const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
          ...((ENV as any).OPENAI_ORG ? { "OpenAI-Organization": (ENV as any).OPENAI_ORG } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant that writes short, clear receipts." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      }, 12_000);

      if (!res.ok) {
        const body = await safeJson(res);
        return { ok: false, error: `OpenAI HTTP ${res.status}${typeof body === "string" ? "" : body?.error?.message ? `: ${body.error.message}` : ""}` };
      }

      const j: any = await safeJson(res);
      const text: string =
        j?.choices?.[0]?.message?.content?.trim?.() ||
        j?.choices?.[0]?.message?.content ||
        "";

      if (text) return { ok: true, text };
      return { ok: true, text: fallbackSummary };
    } catch (e: any) {
      // Final degrade below
    }
  }

  // ---------- 3) Plain-text fallback (no provider) ----------
  return { ok: true, text: fallbackSummary };
}
