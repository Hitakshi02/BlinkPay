"use client";

import { useState } from "react";
import {
  yellowOpenSession,
  yellowSendPayment,
  yellowClose,
  type YellowSession,
} from "@/lib/yellow";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const USER = "0x39cB4842AB4775c7948bA73a09D0E92138479262";
const MERCHANT =
  process.env.NEXT_PUBLIC_MERCHANT ||
  "0x99a44f723bf19D43BE3632679309D9b217BCeE17";

const txUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
const makeId = () => `sess_${Date.now()}`;

type Receipt = {
  id: string;
  user: string;
  merchant: string;
  paid: string;   // base units
  refund: string; // base units
  text: string;
};

export default function Page() {
  const [sessionId, setSessionId] = useState<string>(makeId());
  const [ysess, setYSess] = useState<YellowSession | null>(null);
  const [chainOpen, setChainOpen] = useState<boolean>(false);
  const [offchainTotal, setOffchainTotal] = useState<bigint>(BigInt(0));
  const [lastTx, setLastTx] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");
  const [log, setLog] = useState<string>("");

  // receipt state
  const [showReceipt, setShowReceipt] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const ready = !!ysess && chainOpen; // enable Tip/Settle only when both are ready

  async function call(path: string, body: any) {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "request failed");
    return j;
  }

  async function startSession() {
    try {
      setStatus("opening…");
      setChainOpen(false);
      setOffchainTotal(BigInt(0));
      setReceipt(null);
      setShowReceipt(false);

      // fresh id to avoid "session exists"
      const id = makeId();
      setSessionId(id);

      // 1) OFF-CHAIN: Yellow session (instant)
      const ys = await yellowOpenSession(MERCHANT);
      setYSess(ys);

      // 2) ON-CHAIN: BlinkPay session (allowance)
      const res = await call("/sessions/open", {
        sessionId: id,
        user: USER,
        merchant: MERCHANT,
        allowance: "2000000", // 2.00 PYUSD (6dp)
      });
      setLastTx(res.txHash);
      setChainOpen(true);
      setStatus("ready");
      setLog((l) => l + `\n[open] id=${id} tx=${res.txHash}`);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => l + `\n[open][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  async function tip(delta: bigint) {
    try {
      if (!ready || !ysess) throw new Error("Yellow/on-chain session not ready");
      setStatus("debiting (off-chain)…");

      // 1) OFF-CHAIN instant debit
      const newTotal = await yellowSendPayment(ysess, delta);
      setOffchainTotal(newTotal);

      // 2) Mirror to server for settlement sync
      const res = await call("/sessions/spend", { sessionId, delta: String(delta) });
      setLastTx(res.txHash);
      setStatus("ready");
      setLog((l) => l + `\n[spend] +${Number(delta) / 1_000_000} tx=${res.txHash}`);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => l + `\n[spend][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  async function settle() {
    try {
      if (!ready) throw new Error("No active session to settle");
      setStatus("settling…");

      // close Yellow socket (UI cleanup)
      yellowClose(ysess || undefined);
      setYSess(null);

      // on-chain settlement
      const res = await call("/sessions/settle", { sessionId });
      setLastTx(res.txHash);
      setChainOpen(false);
      setStatus("settled");
      setLog((l) => l + `\n[settle] tx=${res.txHash}`);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => l + `\n[settle][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  async function openReceipt() {
    try {
      const r = await fetch(`${API}/sessions/receipt/${sessionId}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "receipt failed");
      setReceipt(j.receipt as Receipt);
      setShowReceipt(true);
    } catch (e: any) {
      setLog((l) => l + `\n[receipt][error] ${e?.message || e}`);
      console.error(e);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">BlinkPay + Yellow (Nitrolite)</h1>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium">Session ID</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={ready}
          />
        </div>
        <button
          onClick={() => setSessionId(makeId())}
          disabled={ready}
          className={`rounded-lg border px-3 py-2 ${ready ? "opacity-50 cursor-not-allowed" : ""}`}
          title={ready ? "End current session first" : ""}
        >
          New ID
        </button>
      </div>

      {/* single, guarded button row */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={startSession}
          disabled={ready} // prevent double-open
          className={`rounded-xl px-4 py-2 text-white ${ready ? "bg-gray-500 cursor-not-allowed" : "bg-black"}`}
        >
          Start Session (opens Yellow + on-chain)
        </button>

        <button
          onClick={() => tip(BigInt(50000))} // +0.05 PYUSD
          disabled={!ready}
          className={`rounded-xl px-4 py-2 border ${!ready ? "opacity-50 cursor-not-allowed" : ""}`}
          title={!ready ? "Click Start Session first" : ""}
        >
          Tip +0.05 (instant)
        </button>

        <button
          onClick={() => tip(BigInt(100000))} // +0.10 PYUSD
          disabled={!ready}
          className={`rounded-xl px-4 py-2 border ${!ready ? "opacity-50 cursor-not-allowed" : ""}`}
          title={!ready ? "Click Start Session first" : ""}
        >
          +0.10 (instant)
        </button>

        <button
          onClick={settle}
          disabled={!ready}
          className={`rounded-xl px-4 py-2 text-white ${!ready ? "bg-emerald-400 opacity-50 cursor-not-allowed" : "bg-emerald-600"}`}
          title={!ready ? "Start a session before settling" : ""}
        >
          End & Settle
        </button>

        <button
          onClick={openReceipt}
          disabled={status !== "settled"}
          className={`rounded-xl px-4 py-2 border ${status !== "settled" ? "opacity-50 cursor-not-allowed" : ""}`}
          title={status !== "settled" ? "Settle first" : ""}
        >
          View Receipt
        </button>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <div className="text-sm text-gray-500">Running total (off-chain feel, PYUSD 6 dp):</div>
        <div className="text-xl font-mono">
          {(Number(offchainTotal) / 1_000_000).toFixed(6)}
        </div>

        {lastTx && (
          <div className="text-sm">
            Last on-chain tx:{" "}
            <a className="text-blue-600 underline" href={txUrl(lastTx)} target="_blank" rel="noreferrer">
              {lastTx.slice(0, 10)}…
            </a>
          </div>
        )}
        <div className="text-xs text-gray-500">Status: {status}</div>
      </div>

      <div className="rounded-lg border p-3 text-sm font-mono whitespace-pre-wrap">
        <strong>Logs</strong>
        <div>{log || "—"}</div>
      </div>

      <p className="text-xs text-gray-500">
        API: {API}. Amounts use PYUSD base units (6 decimals). Start → Tip(s) → End & Settle.
      </p>

      {/* Receipt modal */}
      {showReceipt && receipt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-[32rem] max-w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Session Receipt</h2>
              <button
                onClick={() => setShowReceipt(false)}
                className="text-sm px-2 py-1 border rounded-md"
              >
                Close
              </button>
            </div>

            <div className="text-sm text-gray-700 whitespace-pre-wrap">
              {receipt.text}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Session:</span> {receipt.id}</div>
              <div>
                <span className="text-gray-500">Paid:</span>{" "}
                {(Number(receipt.paid) / 1_000_000).toFixed(6)} PYUSD
              </div>
              <div className="truncate">
                <span className="text-gray-500">User:</span> {receipt.user}
              </div>
              <div>
                <span className="text-gray-500">Refund:</span>{" "}
                {(Number(receipt.refund) / 1_000_000).toFixed(6)} PYUSD
              </div>
              <div className="truncate col-span-2">
                <span className="text-gray-500">Merchant:</span> {receipt.merchant}
              </div>
            </div>

            {lastTx && (
              <a
                className="inline-block text-blue-600 underline text-sm"
                href={txUrl(lastTx)}
                target="_blank"
                rel="noreferrer"
              >
                View settlement on Etherscan
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
