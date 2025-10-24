// Optional: pretty receipt text. For now return a basic message.
export async function explainTx(txHash: string) {
  return `Settlement submitted: ${txHash}`;
}
