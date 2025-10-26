// src/lib/signer.ts
"use client";

export async function getMessageSigner() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("Install MetaMask");
  const [addr] = await eth.request({ method: "eth_requestAccounts" });
  const sign = (msg: string) => eth.request({ method: "personal_sign", params: [msg, addr] });
  return { addr, sign };
}
