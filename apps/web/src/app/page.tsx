"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  yellowOpenSession,
  yellowSendPayment,
  yellowClose,
  type YellowSession,
} from "@/lib/yellow";

/** ====== ENV / CONFIG ====== */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MERCHANT =
  process.env.NEXT_PUBLIC_MERCHANT ||
  "0x99a44f723bf19D43BE3632679309D9b217BCeE17";
const USER =
  process.env.NEXT_PUBLIC_USER ||
  "0x39cB4842AB4775c7948bA73a09D0E92138479262";
const CHAIN = (process.env.NEXT_PUBLIC_CHAIN || "sepolia").toLowerCase();

/** Etherscan base per chain */
const ETHERSCAN_BASE =
  CHAIN === "sepolia"
    ? "https://sepolia.etherscan.io"
    : CHAIN === "mainnet"
    ? "https://etherscan.io"
    : "https://sepolia.etherscan.io";

/** ====== HELPERS ====== */
type BillingMode = "per-minute" | "per-hour" | "per-session";

const makeId = () => `sess_${Math.floor(Date.now() / 1000)}`;
const txUrl = (hash: string) => `${ETHERSCAN_BASE}/tx/${hash}`;
const cls = (...xs: Array<string | false | undefined>) =>
  xs.filter(Boolean).join(" ");
/** micro-PYUSD <-> float helpers (6 dp) */
const toMicro = (n: number) => BigInt(Math.round(n * 1_000_000));
const fromMicro = (b: bigint) => Number(b) / 1_000_000;

/** ====== UI PRIMITIVES (no extra deps) ====== */
function Card({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
}) {
  return (
    <div
      className={cls(
        "bg-card text-card-foreground rounded-xl shadow-md border border-border p-5 hover:shadow-lg transition-shadow",
        className
      )}
    >
      {title ? (
        typeof title === "string" ? (
          <h2 className="text-lg font-bold mb-4">{title}</h2>
        ) : (
          <div className="mb-4">{title}</div>
        )
      ) : null}
      {children}
    </div>
  );
}

function Button({
  children,
  variant = "default",
  disabled = false,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const variants = {
    default: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    primary:
      "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-sm",
    success:
      "bg-success text-success-foreground hover:bg-success/90 font-semibold shadow-sm",
    secondary: "bg-muted text-muted-foreground hover:bg-muted/80",
  } as const;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cls(
        "px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: "success" | "warning" | "error" | "neutral";
}) {
  const variants = {
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    error: "bg-error/10 text-error border-error/20",
    neutral: "bg-neutral/10 text-neutral border-neutral/20",
  } as const;

  return (
    <span
      className={cls(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        variants[variant]
      )}
    >
      {children}
    </span>
  );
}

function Stepper({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cls(
                "w-2 h-2 rounded-full transition-colors",
                index <= currentStep ? "bg-primary" : "bg-muted"
              )}
            />
            <span
              className={cls(
                "text-xs",
                index <= currentStep ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cls(
                "w-8 h-px",
                index < currentStep ? "bg-primary" : "bg-muted"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2z"
          />
        </svg>
      )}
    </button>
  );
}

/** ====== ChatBox (inline component) ====== */
function ChatBox({
  txHash,
  address,
  chain,
  sessionId,
  user,
  merchant,
}: {
  txHash?: string;
  address?: string;
  chain?: string;
  sessionId?: string;
  user?: string;
  merchant?: string;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: q.trim(),
          txHash,
          address,
          chain,
          sessionId,
          user,
          merchant,
        }),
      });
      const j = await res.json();
      if (!res.ok || j?.ok === false) {
        setErr(j?.error || `HTTP ${res.status}`);
        return;
      }
      setAnswer(j?.text || "");
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border p-4 space-y-3">
      <div className="text-lg font-semibold">Ask BlinkPay (MCP)</div>
      <form onSubmit={ask} className="flex gap-2">
        <input
          className="flex-1 rounded-xl border px-3 py-2"
          placeholder="Ask about this transaction, address, or session…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded-xl border px-4 py-2 disabled:opacity-50"
          disabled={loading || !q.trim()}
          type="submit"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {answer && (
        <pre className="whitespace-pre-wrap text-sm bg-black/5 rounded-xl p-3">
{answer}
        </pre>
      )}
      <div className="text-xs text-black/60">
        Tip: include a <code>tx hash</code> or <code>address</code> for deeper on-chain analysis.
      </div>
    </div>
  );
}

/** ====== MAIN PAGE ====== */
export default function Page() {
  // Core session state
  const [sessionId, setSessionId] = useState<string>("sess_");
  const [ysess, setYSess] = useState<YellowSession | null>(null);
  const [chainOpen, setChainOpen] = useState<boolean>(false);
  const [offchainTotal, setOffchainTotal] = useState<bigint>(BigInt(0));
  const [lastTx, setLastTx] = useState<string>("");
  const [status, setStatus] = useState<"neutral" | "warning" | "success" | "error">("neutral");
  const [log, setLog] = useState<string>("");
  const [allowance, setAllowance] = useState<string>("2000000"); // default 2.00 PYUSD in base unit

  // Controls
  const [billingMode, setBillingMode] = useState<BillingMode>("per-session");
  const [suggestedRate, setSuggestedRate] = useState<number>(0.05);
  const [customTip, setCustomTip] = useState<number>(0.05);

  // UI flow (for stepper)
  const [currentStep, setCurrentStep] = useState<number>(0);
  const ready = !!ysess && chainOpen;

  // LLM receipt
  const [receipt, setReceipt] = useState<string>("");

  const customTipMicro = useMemo(
    () => toMicro(Math.max(0, Number(customTip) || 0)),
    [customTip]
  );

  // Whether running off-chain total exceeds on-chain allowance (allowance stored as base-unit string)
  const overCap = useMemo(() => {
    try {
      return offchainTotal > BigInt(allowance);
    } catch {
      return false;
    }
  }, [offchainTotal, allowance]);

  /** tiny helpers */
  async function post(path: string, body: any) {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      j = { ok: false, error: text };
    }
    if (!j.ok) throw new Error(j.error || `request failed (${r.status})`);
    return j;
  }
  async function getJson(path: string) {
    const r = await fetch(`${API}${path}`);
    const text = await r.text();
    try {
      const j = JSON.parse(text);
      return j;
    } catch {
      return { ok: false, error: `Non-JSON from server: ${text.slice(0, 200)}` };
    }
  }
  const appendLog = (s: string) => setLog((l) => (l ? `${l}\n${s}` : s));

  /** ====== Handlers ====== */
  function handleNewId() {
    if (ready) return;
    setSessionId(makeId());
  }

  async function handleStartSession() {
  try {
    if (!sessionId || !sessionId.startsWith("sess_")) {
      throw new Error("Please enter a session ID starting with 'sess_' (e.g., sess_demo_001).");
    }

    setStatus("warning");
    setCurrentStep(0);
    setChainOpen(false);
    setOffchainTotal(BigInt(0));
    setLastTx("");
    setReceipt("");

    // 1) Off-chain: open Yellow session
    const ys = await yellowOpenSession(MERCHANT);
    setYSess(ys);

    // 2) On-chain: open allowance
    const res = await post("/sessions/open", {
      sessionId,         // <-- use what the user typed
      user: USER,
      merchant: MERCHANT,
      allowance,
      mode: billingMode,
      rate: suggestedRate,
    });

    setLastTx(res.txHash);
    setChainOpen(true);
    setStatus("neutral");
    appendLog(`[open] id=${sessionId} tx=${res.txHash}`);
  } catch (e: any) {
    setStatus("error");
    appendLog(`[open][error] ${e?.message || e}`);
    console.error(e);
  }
}

  async function handleTip(amount: number) {
    try {
      if (!ready || !ysess) throw new Error("Session not ready");
      setStatus("warning");
      setCurrentStep(1);

      const delta = toMicro(amount);

      // Off-chain instant debit via Yellow
      const newTotal = await yellowSendPayment(ysess, delta);
      setOffchainTotal(newTotal);

      const next = offchainTotal + delta;
      if (next > BigInt(allowance)) {
        setStatus("error");
        setLog((l) => l + `\n[guard] tip blocked; ${Number(next)/1_000_000} > ${Number(allowance)/1_000_000}`);
        return;
      }

      try {
        // Mirror to backend (settlement tracker)
        const res = await post("/sessions/spend", { sessionId, delta: String(delta) });
        setLastTx(res.txHash);
        setStatus("neutral");
        appendLog(`[spend] +${amount.toFixed(6)} PYUSD (micro ${delta}) tx=${res.txHash}`);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes("exceeds allowance")) {
          setStatus("error");
          setLog((l) => l + "\n[spend] exceeds allowance. Reduce tip or open a session with a higher allowance.");
          return;
        }
        throw e;
      }
    } catch (e: any) {
      setStatus("error");
      appendLog(`[tip][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  async function handleEndSettle() {
    try {
      if (!ready) throw new Error("No active session");
      setStatus("warning");
      setCurrentStep(2);

      // Close off-chain
      yellowClose(ysess || undefined);
      setYSess(null);

      // Trigger settlement on backend
      const res = await post("/sessions/settle", { sessionId });
      setLastTx(res.txHash);
      setChainOpen(false);
      setStatus("success");
      appendLog(`[settle] tx=${res.txHash}`);
    } catch (e: any) {
      setStatus("error");
      appendLog(`[settle][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  async function handleGenerateReceipt() {
    try {
      setCurrentStep(3);
      setReceipt("Generating…");
      const j = await getJson(`/sessions/receipt-llm/${sessionId}`);
      setReceipt(j.text);
    } catch (e: any) {
      setReceipt(`AI error: ${e?.message || e}`);
    }
  }

  /** subtle pulse while "warning" */
  useEffect(() => {
    let t: any;
    if (status === "warning") {
      t = setTimeout(() => setStatus("neutral"), 1200);
    }
    return () => clearTimeout(t);
  }, [status]);

  const steps = ["Start", "Tip", "Settle", "Receipt"];

  /** ====== RENDER ====== */
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 relative">
      {/* Background (CSP-safe: /public/ppbg.jpg) */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-80"
        style={{ backgroundImage: "url('/ppbg.jpg')" }}
      />

      {/* Content Layer */}
      <div className="relative z-10 max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-balance tracking-tight text-white">
                BlinkPay + Yellow
              </h1>
              <p className="text-sm text-gray-200 mt-1">
                Nitrolite payment flow • Real-time PYUSD settlements
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={status}>
                {status === "success"
                  ? "SUCCESS"
                  : status === "warning"
                  ? "WORKING"
                  : status === "error"
                  ? "ERROR"
                  : "IDLE"}
              </Badge>
              <a
                href={API}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 transition-colors underline font-medium"
              >
                {API.replace(/^https?:\/\//, "")}
              </a>
            </div>
          </div>
        </header>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Session & Billing */}
          <Card title="Session & Billing" className="lg:col-span-1">
            <div className="space-y-3.5">
              {/* Session ID */}
              <div>
                <label className="block text-sm font-semibold mb-1.5">Session ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    placeholder="Enter session ID"
                    className="flex-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    disabled={ready}
                  />
                  <Button variant="secondary" onClick={handleNewId} disabled={ready}>
                    New ID
                  </Button>
                </div>
              </div>

              {/* Billing Mode */}
              <div>
                <label className="block text-sm font-semibold mb-1.5">Billing Mode</label>
                <select
                  value={billingMode}
                  onChange={(e) => setBillingMode(e.target.value as BillingMode)}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                >
                  <option value="per-session">Per Session</option>
                  <option value="per-minute">Per Minute</option>
                  <option value="per-hour">Per Hour</option>
                </select>
              </div>

              {/* Suggested Rate (UI hint only) */}
              <div>
                <label className="block text-sm font-semibold mb-1.5">Suggested Rate (PYUSD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={suggestedRate}
                  onChange={(e) => setSuggestedRate(Number.parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>

              {/* Custom Tip */}
              <div>
                <label className="block text-sm font-semibold mb-1.5">Custom Tip (PYUSD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customTip}
                  onChange={(e) => setCustomTip(Number.parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>

              {/* Actions */}
              <div className="space-y-2.5 pt-2">
                <Button
                  variant="primary"
                  onClick={handleStartSession}
                  disabled={ready || !sessionId}
                  className="w-full"
                >
                  Start Session
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => handleTip(0.05)}
                    disabled={!ready}
                    className="flex-1"
                  >
                    Tip +0.05
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleTip(0.1)}
                    disabled={!ready}
                    className="flex-1"
                  >
                    Tip +0.10
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleTip(Number(customTip || 0))}
                    disabled={!ready || Number(customTip) <= 0}
                    className="flex-1"
                  >
                    Tip {Number(customTip || 0).toFixed(2)}
                  </Button>
                </div>

                <Button
                  variant="success"
                  onClick={handleEndSettle}
                  disabled={!ready}
                  className="w-full"
                >
                  End & Settle
                </Button>
              </div>
            </div>
          </Card>

          {/* Running Total & Settlement */}
          <Card title="Running Total & Settlement" className="lg:col-span-1">
            <div className="space-y-4">
              {/* Big Total */}
              <div className="text-center py-6 bg-muted/30 rounded-lg">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Total Amount
                </div>
                <div className="text-4xl font-mono font-bold text-balance text-primary">
                  {fromMicro(offchainTotal).toFixed(6)}
                </div>
                <div className="text-sm font-semibold text-muted-foreground mt-2">PYUSD</div>
              </div>

              {/* Allowance guard (FIX: previously outside JSX) */}
              {overCap && (
                <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
                  You’ve reached the session allowance. Reduce the tip or start a new session with a higher allowance.
                </div>
              )}

              {/* Transaction Hash */}
              {lastTx && (
                <div>
                  <label className="block text-sm font-semibold mb-1.5">Last Transaction</label>
                  <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                    <a
                      href={txUrl(lastTx)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-xs font-mono truncate text-primary hover:text-primary/80 transition-colors"
                    >
                      {lastTx}
                    </a>
                    <CopyButton text={lastTx} />
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="flex justify-center">
                <Badge variant={status}>
                  {status === "success" && "✓ Settled"}
                  {status === "warning" && "⋯ In Progress"}
                  {status === "error" && "✕ Error"}
                  {status === "neutral" && "○ Idle"}
                </Badge>
              </div>

              {/* Stepper */}
              <div className="flex justify-center pt-2">
                <Stepper steps={steps} currentStep={currentStep} />
              </div>
            </div>
          </Card>

          {/* Smart Receipt (LLM) */}
          <Card
            className="lg:col-span-1"
            title={
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">Smart Receipt (LLM)</span>
                <Button
                  variant="primary"
                  onClick={handleGenerateReceipt}
                  disabled={!lastTx || ready}
                >
                  Generate
                </Button>
              </div>
            }
          >
            {receipt ? (
              <pre className="p-4 bg-muted/50 border border-border rounded-lg text-xs font-mono whitespace-pre-wrap overflow-auto leading-relaxed max-h-[280px]">
                {receipt}
              </pre>
            ) : (
              <div className="p-8 bg-muted/30 border-2 border-dashed border-border rounded-lg text-center text-sm text-muted-foreground">
                Receipt will appear here after generation
              </div>
            )}

            {/* ===== ChatBox mounted right under receipt ===== */}
            <ChatBox
              txHash={lastTx || undefined}
              chain={CHAIN}
              sessionId={sessionId}
              user={USER}
              merchant={MERCHANT}
            />
          </Card>
        </div>

        {/* Logs */}
        <Card title="Logs">
          <pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed">
            {log || "—"}
          </pre>
        </Card>

        <p className="text-xs text-gray-200">
          API: {API}. Flow: Start → Tip(s) → End & Settle → Generate Receipt.
        </p>
      </div>
    </div>
  );
}



// "use client";

// import { useMemo, useState } from "react";
// import {
//   yellowOpenSession,
//   yellowSendPayment,
//   yellowClose,
//   type YellowSession,
// } from "@/lib/yellow";

// const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
// const USER = "0x39cB4842AB4775c7948bA73a09D0E92138479262";
// const MERCHANT =
//   process.env.NEXT_PUBLIC_MERCHANT ||
//   "0x99a44f723bf19D43BE3632679309D9b217BCeE17";

// const txUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
// const makeId = () => `sess_${Date.now()}`;

// type BillingMode = "per-minute" | "per-hour" | "per-session";

// export default function Page() {
//   const [sessionId, setSessionId] = useState<string>(makeId());
//   const [ysess, setYSess] = useState<YellowSession | null>(null);
//   const [chainOpen, setChainOpen] = useState<boolean>(false);
//   const [offchainTotal, setOffchainTotal] = useState<bigint>(BigInt(0));
//   const [lastTx, setLastTx] = useState<string>("");
//   const [status, setStatus] = useState<string>("idle");
//   const [log, setLog] = useState<string>("");

//   // NEW: controls
//   const [mode, setMode] = useState<BillingMode>("per-session");
//   const [rate, setRate] = useState<string>("0.05"); // PYUSD (UI-only hint)
//   const [customTip, setCustomTip] = useState<string>("0.05"); // PYUSD

//   const ready = !!ysess && chainOpen;
//   const customTipBase = useMemo(() => {
//     const n = Number(customTip);
//     return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 1_000_000)) : BigInt(0);
//   }, [customTip]);

//   async function post(path: string, body: any) {
//     const r = await fetch(`${API}${path}`, {
//       method: "POST",
//       headers: { "content-type": "application/json" },
//       body: JSON.stringify(body),
//     });
//     const j = await r.json();
//     if (!j.ok) throw new Error(j.error || "request failed");
//     return j;
//   }
//   async function getJson(path: string) {
//     const r = await fetch(`${API}${path}`);
//     const j = await r.json();
//     if (!j.ok) throw new Error(j.error || "request failed");
//     return j;
//   }

//   async function startSession() {
//     try {
//       setStatus("opening…");
//       setChainOpen(false);
//       setOffchainTotal(BigInt(0));

//       const id = makeId();
//       setSessionId(id);

//       // OFF-CHAIN
//       const ys = await yellowOpenSession(MERCHANT);
//       setYSess(ys);

//       // ON-CHAIN (2.00 PYUSD allowance)
//       const res = await post("/sessions/open", {
//         sessionId: id,
//         user: USER,
//         merchant: MERCHANT,
//         allowance: "2000000",
//         // (Optional) if you later pass these to server, include mode/rate
//       });
//       setLastTx(res.txHash);
//       setChainOpen(true);
//       setStatus("ready");
//       setLog((l) => l + `\n[open] id=${id} tx=${res.txHash}`);
//     } catch (e: any) {
//       setStatus("error");
//       setLog((l) => l + `\n[open][error] ${e?.message || e}`);
//       console.error(e);
//     }
//   }

//   async function tip(delta: bigint) {
//     try {
//       if (!ready || !ysess) throw new Error("Session not ready");
//       setStatus("debiting (off-chain)…");

//       // OFF-CHAIN instant
//       const newTotal = await yellowSendPayment(ysess, delta);
//       setOffchainTotal(newTotal);

//       // Mirror to backend (on-chain settlement tracker)
//       const res = await post("/sessions/spend", { sessionId, delta: String(delta) });
//       setLastTx(res.txHash);
//       setStatus("ready");
//       setLog((l) => l + `\n[spend] +${Number(delta) / 1_000_000} tx=${res.txHash}`);
//     } catch (e: any) {
//       setStatus("error");
//       setLog((l) => l + `\n[spend][error] ${e?.message || e}`);
//       console.error(e);
//     }
//   }

//   async function settle() {
//     try {
//       if (!ready) throw new Error("No active session");
//       setStatus("settling…");

//       yellowClose(ysess || undefined);
//       setYSess(null);

//       const res = await post("/sessions/settle", { sessionId });
//       setLastTx(res.txHash);
//       setChainOpen(false);
//       setStatus("settled");
//       setLog((l) => l + `\n[settle] tx=${res.txHash}`);
//     } catch (e: any) {
//       setStatus("error");
//       setLog((l) => l + `\n[settle][error] ${e?.message || e}`);
//       console.error(e);
//     }
//   }

//   // NEW: LLM receipt
//   const [llmText, setLlmText] = useState<string>("");
//   async function fetchLlmReceipt() {
//     try {
//       setLlmText("Generating…");
//       const j = await getJson(`/sessions/receipt-llm/${sessionId}`);
//       setLlmText(j.text);
//     } catch (e: any) {
//       setLlmText(`AI error: ${e?.message || e}`);
//     }
//   }

//   return (
//     <main className="mx-auto max-w-xl p-6 space-y-6">
//       <h1 className="text-2xl font-semibold">BlinkPay + Yellow (Nitrolite)</h1>

//       {/* Session row */}
//       <div className="flex items-end gap-2">
//         <div className="flex-1">
//           <label className="text-sm font-medium">Session ID</label>
//           <input
//             className="w-full rounded-lg border px-3 py-2"
//             value={sessionId}
//             onChange={(e) => setSessionId(e.target.value)}
//             disabled={ready}
//           />
//         </div>
//         <button
//           onClick={() => setSessionId(makeId())}
//           disabled={ready}
//           className={`rounded-lg border px-3 py-2 ${ready ? "opacity-50 cursor-not-allowed" : ""}`}
//           title={ready ? "End current session first" : ""}
//         >
//           New ID
//         </button>
//       </div>

//       {/* Billing controls */}
//       <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
//         <div>
//           <label className="text-sm font-medium">Billing Mode</label>
//           <select
//             value={mode}
//             onChange={(e) => setMode(e.target.value as BillingMode)}
//             className="w-full rounded-lg border px-3 py-2"
//           >
//             <option value="per-session">Per Session</option>
//             <option value="per-minute">Per Minute</option>
//             <option value="per-hour">Per Hour</option>
//           </select>
//         </div>
//         <div>
//           <label className="text-sm font-medium">Suggested Rate (PYUSD)</label>
//           <input
//             type="number"
//             step="0.01"
//             min="0"
//             value={rate}
//             onChange={(e) => setRate(e.target.value)}
//             className="w-full rounded-lg border px-3 py-2"
//           />
//         </div>
//         <div>
//           <label className="text-sm font-medium">Custom Tip (PYUSD)</label>
//           <input
//             type="number"
//             step="0.01"
//             min="0"
//             value={customTip}
//             onChange={(e) => setCustomTip(e.target.value)}
//             className="w-full rounded-lg border px-3 py-2"
//           />
//         </div>
//       </div>

//       {/* Actions */}
//       <div className="flex gap-3 flex-wrap">
//         <button
//           onClick={startSession}
//           disabled={ready}
//           className={`rounded-xl px-4 py-2 text-white ${ready ? "bg-gray-500 cursor-not-allowed" : "bg-black"}`}
//         >
//           Start Session (opens Yellow + on-chain)
//         </button>

//         <button
//           onClick={() => tip(BigInt(50_000))} // +0.05
//           disabled={!ready}
//           className={`rounded-xl px-4 py-2 border ${!ready ? "opacity-50 cursor-not-allowed" : ""}`}
//         >
//           Tip +0.05
//         </button>

//         <button
//           onClick={() => tip(BigInt(100_000))} // +0.10
//           disabled={!ready}
//           className={`rounded-xl px-4 py-2 border ${!ready ? "opacity-50 cursor-not-allowed" : ""}`}
//         >
//           +0.10
//         </button>

//         <button
//           onClick={() => tip(customTipBase)} // custom tip
//           disabled={!ready || customTipBase <= 0}
//           className={`rounded-xl px-4 py-2 border ${!ready || customTipBase <= 0 ? "opacity-50 cursor-not-allowed" : ""}`}
//         >
//           Tip {Number(customTip || 0).toFixed(2)}
//         </button>

//         <button
//           onClick={settle}
//           disabled={!ready}
//           className={`rounded-xl px-4 py-2 text-white ${!ready ? "bg-emerald-400 opacity-50 cursor-not-allowed" : "bg-emerald-600"}`}
//         >
//           End & Settle
//         </button>
//       </div>

//       {/* Totals + last tx */}
//       <div className="rounded-lg border p-4 space-y-2">
//         <div className="text-sm text-gray-500">
//           Running total (off-chain feel, PYUSD 6 dp) — Mode: {mode}{rate ? ` @ ${rate}` : ""}.
//         </div>
//         <div className="text-xl font-mono">
//           {(Number(offchainTotal) / 1_000_000).toFixed(6)}
//         </div>
//         {lastTx && (
//           <div className="text-sm">
//             Last on-chain tx:{" "}
//             <a className="text-blue-600 underline" href={txUrl(lastTx)} target="_blank" rel="noreferrer">
//               {lastTx.slice(0, 10)}…
//             </a>
//           </div>
//         )}
//         <div className="text-xs text-gray-500">Status: {status}</div>
//       </div>

//       {/* Smart (LLM) Receipt */}
//       <div className="rounded-lg border p-4 space-y-2">
//         <div className="flex items-center justify-between">
//           <h2 className="font-medium">Smart Receipt (LLM)</h2>
//           <button
//             onClick={fetchLlmReceipt}
//             className="rounded-lg border px-3 py-2"
//           >
//             Generate
//           </button>
//         </div>
//         <pre className="text-sm whitespace-pre-wrap font-mono">
//           {llmText || "No receipt yet."}
//         </pre>
//       </div>

//       {/* Logs */}
//       <div className="rounded-lg border p-3 text-sm font-mono whitespace-pre-wrap">
//         <strong>Logs</strong>
//         <div>{log || "—"}</div>
//       </div>

//       <p className="text-xs text-gray-500">
//         API: {API}. Start → Tip(s) → End & Settle. Then “Generate” for an LLM receipt.
//       </p>
//     </main>
//   );
// }
