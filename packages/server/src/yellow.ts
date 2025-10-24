// Minimal Yellow/Nitrolite session stub (replace with real SDK calls)
type Session = { id: string; user: string; merchant: string; allowance: bigint; spent: bigint; active: boolean; }
const memory: Record<string, Session> = {};

export function openYellowSession(id: string, user: string, merchant: string, allowance: bigint) {
  memory[id] = { id, user, merchant, allowance, spent: 0n, active: true };
  return memory[id];
}
export function addSpend(id: string, delta: bigint) {
  const s = memory[id]; if (!s || !s.active) throw new Error("no session");
  const newSpent = s.spent + delta;
  if (newSpent > s.allowance) throw new Error("exceeds allowance");
  s.spent = newSpent; return s;
}
export function endSession(id: string) {
  const s = memory[id]; if (!s) throw new Error("no session");
  s.active = false; return s;
}
export function getSession(id: string) { return memory[id]; }
