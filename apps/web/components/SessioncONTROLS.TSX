"use client";
import { useState } from "react";
import axios from "axios";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseEther } from "viem";
import { VAULT_ABI, ERC20_ABI, VAULT_ADDRESS, PYUSD, SERVER_URL } from "../lib/contract";

export default function SessionControls() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [sessionId, setSessionId] = useState<string>("");
  const [allowance, setAllowance] = useState<string>("10"); // default 10 PYUSD
  const [delta, setDelta] = useState<string>("0.05");       // spend per click

  async function approveAndDeposit() {
    if (!address) return alert("Connect wallet");
    const amount = parseEther(allowance);
    await writeContractAsync({ address: PYUSD as `0x${string}`, abi: ERC20_ABI, functionName: "approve", args: [VAULT_ADDRESS, amount]});
    await writeContractAsync({ address: VAULT_ADDRESS as `0x${string}`, abi: VAULT_ABI, functionName: "deposit", args: [amount]});
    alert("Deposited");
  }

  async function openSession() {
    if (!address) return alert("Connect wallet");
    const id = crypto.randomUUID();
    setSessionId(id);
    const wei = parseEther(allowance).toString();
    await axios.post(`${SERVER_URL}/api/session/open`, { sessionId: id, user: address, allowance: wei });
    alert("Session opened");
  }

  async function spendDelta() {
    if (!sessionId) return alert("No session");
    const wei = parseEther(delta).toString();
    await axios.post(`${SERVER_URL}/api/session/spend`, { sessionId, delta: wei });
  }

  async function settle() {
    if (!sessionId) return alert("No session");
    const r = await axios.post(`${SERVER_URL}/api/session/settle`, { sessionId });
    alert(`Settled. tx: ${r.data.txHash}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="border p-2 flex-1" value={allowance} onChange={e=>setAllowance(e.target.value)} placeholder="Allowance PYUSD"/>
        <button className="border px-3 py-2" onClick={approveAndDeposit}>Approve+Deposit</button>
      </div>
      <div className="flex gap-2">
        <button className="border px-3 py-2" onClick={openSession}>Start Session</button>
        <input className="border p-2 w-32" value={delta} onChange={e=>setDelta(e.target.value)} placeholder="Spend PYUSD"/>
        <button className="border px-3 py-2" onClick={spendDelta}>+ Spend</button>
        <button className="border px-3 py-2" onClick={settle}>End & Settle</button>
      </div>
      <div className="text-sm opacity-70">Session ID: {sessionId || "—"}</div>
    </div>
  );
}
