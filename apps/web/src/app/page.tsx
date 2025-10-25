"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const USER = "0x39cB4842AB4775c7948bA73a09D0E92138479262";
const MERCHANT = process.env.NEXT_PUBLIC_MERCHANT || "0x99a44f723bf19D43BE3632679309D9b217BCeE17";

// helper: link to Sepolia
const txUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

export default function Page() {
  const [sessionId, setSessionId] = useState("sess_demo_1");
  const [total, setTotal] = useState<bigint>(BigInt(0));
  const [lastTx, setLastTx] = useState<string>("");

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
    const res = await call("/sessions/open", {
      sessionId,
      user: USER,
      merchant: MERCHANT,
      allowance: "2000000", // 2.000000 PYUSD (6 decimals)
    });
    setLastTx(res.txHash);
    setTotal(BigInt(0));
  }

  async function tip(delta: bigint) {
    const res = await call("/sessions/spend", {
      sessionId,
      delta: String(delta), // base units
    });
    setTotal(BigInt(res.newTotal));
    setLastTx(res.txHash);
  }

  async function settle() {
    const res = await call("/sessions/settle", { sessionId });
    setLastTx(res.txHash);
  }

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">BlinkPay — PYUSD Session</h1>

      <div className="space-y-2">
        <label className="text-sm font-medium">Session ID</label>
        <input
          className="w-full rounded-lg border px-3 py-2"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={startSession}
          className="rounded-xl px-4 py-2 bg-black text-white"
        >
          Start Session (2.00 PYUSD)
        </button>
        <button
          onClick={() => tip(BigInt(50000))} // +0.05
          className="rounded-xl px-4 py-2 border"
        >
          Tip +0.05
        </button>
        <button
          onClick={() => tip(BigInt(100000))} // +0.10
          className="rounded-xl px-4 py-2 border"
        >
          +0.10
        </button>
        <button
          onClick={settle}
          className="rounded-xl px-4 py-2 bg-emerald-600 text-white"
        >
          End & Settle
        </button>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <div className="text-sm text-gray-500">Running total (PYUSD, 6 dp):</div>
        <div className="text-xl font-mono">
          {(Number(total) / 1_000_000).toFixed(6)}
        </div>
        {lastTx && (
          <div className="text-sm">
            Last tx:{" "}
            <a className="text-blue-600 underline" href={txUrl(lastTx)} target="_blank">
              {lastTx.slice(0, 10)}…
            </a>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Make sure the server is running on {API}. Amounts use PYUSD base units (6 decimals).
      </p>
    </main>
  );
}
