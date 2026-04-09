// Thin Solana data layer for SolSentinel.
// Uses Helius RPC for wallet state and Jupiter Price API for USD pricing.
// Node 23+ has fetch built-in, so no extra deps.

export interface TokenHolding {
  mint: string;
  amount: number;
}

export interface WalletSnapshot {
  wallet: string;
  solBalance: number;
  solPriceUsd: number;
  tokens: TokenHolding[];
  totalUsd: number;
  fetchedAt: number;
}

const JUP_PRICE_API = "https://price.jup.ag/v6/price";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function heliusUrl(apiKey: string): string {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`Helius RPC ${method} failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(`Helius RPC error: ${data.error.message}`);
  return data.result as T;
}

export async function fetchSolPriceUsd(): Promise<number> {
  try {
    const res = await fetch(`${JUP_PRICE_API}?ids=SOL`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { data?: { SOL?: { price?: number } } };
    return data.data?.SOL?.price ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchWalletSnapshot(
  wallet: string,
  heliusKey: string
): Promise<WalletSnapshot> {
  const url = heliusUrl(heliusKey);

  const [balanceResult, tokenResult, solPriceUsd] = await Promise.all([
    rpc<{ value: number }>(url, "getBalance", [wallet]),
    rpc<{ value: Array<{ account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number } } } } } }> }>(
      url,
      "getTokenAccountsByOwner",
      [wallet, { programId: SPL_TOKEN_PROGRAM }, { encoding: "jsonParsed" }]
    ),
    fetchSolPriceUsd(),
  ]);

  const solBalance = (balanceResult?.value ?? 0) / 1e9;

  const tokens: TokenHolding[] = (tokenResult?.value ?? [])
    .map((t) => ({
      mint: t.account.data.parsed.info.mint,
      amount: Number(t.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    }))
    .filter((t) => t.amount > 0);

  // MVP: price SOL only. SPL pricing is a post-hackathon improvement
  // since per-token Jupiter lookups would slow the demo.
  const totalUsd = solBalance * solPriceUsd;

  return {
    wallet,
    solBalance,
    solPriceUsd,
    tokens,
    totalUsd,
    fetchedAt: Date.now(),
  };
}

export function formatSnapshot(s: WalletSnapshot): string {
  const lines = [
    `Wallet: ${s.wallet.slice(0, 4)}...${s.wallet.slice(-4)}`,
    `SOL: ${s.solBalance.toFixed(3)} ($${s.totalUsd.toFixed(2)})`,
    `SPL tokens: ${s.tokens.length}`,
  ];
  return lines.join("\n");
}
