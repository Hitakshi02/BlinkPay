"use client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "../lib/wagmi";
import SessionControls from "../components/SessionControls";

const qc = new QueryClient();

export default function Page() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <main className="p-6 max-w-xl mx-auto">
          <h1 className="text-2xl font-bold">BlinkPay — PYUSD Sessions</h1>
          <p className="text-sm opacity-80 mb-4">Deposit once → instant micro-actions → settle once.</p>
          <SessionControls />
        </main>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
