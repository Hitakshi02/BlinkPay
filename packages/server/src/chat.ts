// packages/server/src/chat.ts
import { ENV } from "./env";
import {
  SUPER_PROMPT_SYSTEM,
  SUPER_PROMPT_TEMPLATE,
  FEW_SHOTS,
} from "./prompts/blockscout";

const CHAIN_ID_MAP: Record<string, string> = {
  // L1s
  ethereum: "1",
  mainnet: "1",
  holesky: "17000",

  // L2s / sidechains
  optimism: "10",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",

  // Testnets
  sepolia: "11155111",
  "arbitrum-sepolia": "421614",
  "base-sepolia": "84532",
  "optimism-sepolia": "11155420",
  "polygon-amoy": "80002",
};

function normalizeChainId(chain?: string): string {
  if (!chain) return "11155111"; // default to sepolia for your demo
  const c = chain.toLowerCase().trim();
  return CHAIN_ID_MAP[c] || c; // if already numeric, pass through
}
/** ================= helpers ================= */
function fetchWithTimeout(url: string, init: RequestInit, ms = 12_000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...init, signal: ac.signal }).finally(() =>
    clearTimeout(id)
  );
}
async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}
const asBullets = (lines: Array<string | undefined>) =>
  lines.filter(Boolean).map((l) => `• ${l}`).join("\n");

function fill(template: string, vars: Record<string, string | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "N/A");
}

/** ================= types ================= */
export type ChatInput = {
  message: string;
  txHash?: string;
  address?: string;
  chain?: string; // e.g. "sepolia", "ethereum", "polygon"
  sessionId?: string;
  user?: string;
  merchant?: string;
};

export type ChatResult =
  | { ok: true; text: string }
  | { ok: true; pending: true; text: string }
  | { ok: false; error: string };

/** ================= prompt build ================= */
function buildPrompt(input: ChatInput) {
  const templ = fill(SUPER_PROMPT_TEMPLATE, {
    chain: input.chain || "auto",
    txHash: input.txHash || "N/A",
    address: input.address || "N/A",
    sessionId: input.sessionId || "N/A",
    question: input.message,
  });

  const few = FEW_SHOTS.map(
    (fs) => `User:\n${fs.user}\nAssistant:\n${fs.assistant}`
  ).join("\n\n");

  return `${templ}\n\nFew-shot examples:\n${few}`;
}

/** ================= REST fallback =================
 * Works with local MCP started with --rest (exposes /v1/tools/*)
 */
async function restCallTool(
  base: string,
  tool: string,
  args: Record<string, any>
) {
  const url = `${base.replace(/\/+$/, "")}/v1/tools/${tool}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ENV.BLOCKSCOUT_MCP_API_KEY
          ? { authorization: `Bearer ${ENV.BLOCKSCOUT_MCP_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(args),
    },
    16_000
  );
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(
      `REST ${tool} HTTP ${res.status}${
        typeof body === "string" ? "" : body?.error ? `: ${body.error}` : ""
      }`
    );
  }
  return safeJson(res);
}

/** ================= main ================= */
export async function chatWithMCP(input: ChatInput): Promise<ChatResult> {
  const base = (ENV as any).BLOCKSCOUT_MCP_URL || "";
  const prompt = buildPrompt(input);

  /** ---- 1) Prefer JSON-RPC tools on MCP (works with hosted endpoint) ---- */
  if (base) {
    try {
      // Pick a tool based on anchors
      const chainId = normalizeChainId(input.chain);
      const chain = chainId;
      let name = "get_latest_block";
      let arguments_: Record<string, any> = { chain_id: chain };

      if (input.txHash) {
        name = "transaction_summary";
        arguments_ = { chain_id: chain, hash: input.txHash };
      } else if (input.address) {
        name = "get_address_info";
        arguments_ = { chain_id: chain, address: input.address };
      }

      // JSON-RPC payload
      const rpcBody = {
        jsonrpc: "2.0",
        id: "blinkpay-chat",
        method: "tools/call",
        params: { name, arguments: arguments_ },
      };

      const res = await fetchWithTimeout(
        base, // hosted MCP expects /mcp as the full endpoint already
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // crucial for MCP HTTP transport
            accept: "application/json, text/event-stream",
            ...(ENV.BLOCKSCOUT_MCP_API_KEY
              ? { authorization: `Bearer ${ENV.BLOCKSCOUT_MCP_API_KEY}` }
              : {}),
          },
          body: JSON.stringify(rpcBody),
        },
        18_000
      );

      if (!res.ok) {
        const body = await safeJson(res);
        if ((res.status as any) === 425) {
          return {
            ok: true,
            pending: true,
            text:
              "Explorer is still indexing data for this query. Please retry shortly.",
          };
        }
        // If endpoint doesn't support JSON-RPC/tooling, we'll try REST next
        throw new Error(
          `MCP JSON-RPC HTTP ${res.status}${
            typeof body === "string" ? "" : body?.error ? `: ${body.error}` : ""
          }`
        );
      }

      const j: any = await safeJson(res);
      // Common result shapes from tools/call
      const text =
        j?.result?.summary ||
        j?.result?.content ||
        j?.result?.text ||
        j?.text ||
        j?.message ||
        (typeof j === "string" ? j : "");

      if (text && typeof text === "string") {
        // Optionally append anchors so the answer is contextual for the UI
        const extra = asBullets([
          input.sessionId ? `Session: ${input.sessionId}` : undefined,
          input.merchant ? `Merchant: ${input.merchant}` : undefined,
        ]);
        return { ok: true, text: extra ? `${text}\n${extra}` : text };
      }
      // Unexpected shape — still succeed
      return {
        ok: true,
        text:
          "• MCP responded; result parsed but no summary text returned. Try specifying a tx hash or address.",
      };
    } catch {
      // continue to REST fallback
    }

    /** ---- 2) REST fallback (local MCP with --rest) ---- */
    try {
      const chain = input.chain || "sepolia";

      if (input.txHash) {
        const j: any = await restCallTool(base, "transaction_summary", {
          chain_id: chain,
          hash: input.txHash,
        });
        const bullets = [
          j?.summary ? String(j.summary) : undefined,
          input.sessionId ? `Session: ${input.sessionId}` : undefined,
          input.merchant ? `Merchant: ${input.merchant}` : undefined,
        ];
        return { ok: true, text: asBullets(bullets) || "• Transaction summarized." };
      }

      if (input.address) {
        const info: any = await restCallTool(base, "get_address_info", {
          chain_id: chain,
          address: input.address,
        });
        const lines = [
          `Address: ${input.address} on ${chain}`,
          info?.is_contract ? "Contract account" : "EOA",
          info?.ens ? `ENS: ${info.ens}` : undefined,
          info?.balance ? `Native balance: ${info.balance}` : undefined,
          info?.token_count ? `Token positions: ${info.token_count}` : undefined,
        ];
        return { ok: true, text: asBullets(lines) };
      }

      const blk: any = await restCallTool(base, "get_latest_block", {
        chain_id: chain,
      });
      return {
        ok: true,
        text: asBullets([`Latest block on ${chain}: ${blk?.number || "unknown"}`]),
      };
    } catch {
      // fall through to OpenAI
    }
  }

  /** ---- 3) OpenAI fallback (optional) ---- */
  if ((ENV as any).OPENAI_API_KEY) {
    try {
      const res = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${(ENV as any).OPENAI_API_KEY}`,
            ...((ENV as any).OPENAI_ORG
              ? { "OpenAI-Organization": (ENV as any).OPENAI_ORG }
              : {}),
          },
          body: JSON.stringify({
            model: (ENV as any).OPENAI_MODEL || "gpt-4o-mini",
            messages: [
              { role: "system", content: SUPER_PROMPT_SYSTEM.trim() },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
          }),
        },
        18_000
      );

      if (!res.ok) {
        const body = await safeJson(res);
        return {
          ok: false,
          error: `OpenAI HTTP ${res.status}${
            typeof body === "string"
              ? ""
              : body?.error?.message
              ? `: ${body.error.message}`
              : ""
          }`,
        };
      }

      const j: any = await safeJson(res);
      const text: string =
        j?.choices?.[0]?.message?.content?.trim?.() ||
        j?.choices?.[0]?.message?.content ||
        "";
      return {
        ok: true,
        text:
          text ||
          "• Summary unavailable; please include a tx hash or address and try again.",
      };
    } catch {}
  }

  /** ---- 4) Final degrade ---- */
  return {
    ok: true,
    text: "• I couldn’t reach MCP/LLM. Include a tx hash or address and try again.",
  };
}
