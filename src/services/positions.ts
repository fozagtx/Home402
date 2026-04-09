// DeFi risk signal source for SolSentinel.
//
// This module uses live on-chain transactions (via Helius RPC) to detect
// whether a wallet has recently interacted with Kamino / MarginFi / Drift.
// It intentionally avoids fabricated liquidation metrics; output is strictly
// evidence-based "risk signals" derived from observed activity.

export type Protocol = "kamino" | "marginfi" | "drift";

export interface Position {
  protocol: Protocol;
  market: string;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  interactionCount: number;
  failedInteractionCount: number;
  lastInteractionTs: number | null;
}

export interface PositionAlert {
  position: Position;
  severity: "warn" | "critical";
  message: string;
}

export class PositionsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionsUnavailableError";
  }
}

const HELIUS_MAINNET = "https://mainnet.helius-rpc.com/?api-key=";
const LOOKBACK_SIGNATURES = 35;
const PROGRAM_IDS: Record<Protocol, string> = {
  kamino: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  marginfi: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
  drift: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
};

function getHeliusKey(explicitKey?: string): string {
  if (explicitKey && explicitKey.length > 0) return explicitKey;
  return process.env.HELIUS_API_KEY ?? "";
}

function heliusUrl(explicitKey?: string): string {
  const key = getHeliusKey(explicitKey);
  if (!key) {
    throw new PositionsUnavailableError(
      "HELIUS_API_KEY is missing; cannot run live DeFi risk scanning."
    );
  }
  return `${HELIUS_MAINNET}${key}`;
}

async function rpc<T>(
  method: string,
  params: unknown[],
  explicitKey?: string
): Promise<T> {
  const res = await fetch(heliusUrl(explicitKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new PositionsUnavailableError(
      `Helius RPC ${method} failed: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) {
    throw new PositionsUnavailableError(`Helius RPC error: ${data.error.message}`);
  }
  return data.result as T;
}

interface SignatureInfo {
  signature: string;
  blockTime?: number | null;
  err?: unknown;
}

interface TransactionResult {
  blockTime?: number | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
  meta?: {
    err?: unknown;
  };
}

function accountKeyToString(key: string | { pubkey?: string }): string {
  if (typeof key === "string") return key;
  return key.pubkey ?? "";
}

function classifyRisk(
  interactionCount: number,
  failedInteractionCount: number,
  hoursSinceLast: number | null
): { riskLevel: "low" | "medium" | "high"; reason: string } {
  if (interactionCount === 0) {
    return {
      riskLevel: "low",
      reason: "No recent protocol interactions found in on-chain history.",
    };
  }

  if (failedInteractionCount >= 2) {
    return {
      riskLevel: "high",
      reason:
        "Multiple recent failed transactions against this protocol; review open exposure and collateral.",
    };
  }

  if (failedInteractionCount >= 1) {
    return {
      riskLevel: "medium",
      reason:
        "At least one recent failed protocol transaction detected; verify account health.",
    };
  }

  if (hoursSinceLast !== null && hoursSinceLast <= 6) {
    return {
      riskLevel: "medium",
      reason: "Recent active leverage-related protocol interaction detected.",
    };
  }

  return {
    riskLevel: "low",
    reason: "Protocol activity detected, but no immediate risk signal.",
  };
}

export async function fetchPositions(
  wallet: string,
  heliusKey?: string
): Promise<Position[]> {
  const signatures = await rpc<SignatureInfo[]>("getSignaturesForAddress", [
    wallet,
    { limit: LOOKBACK_SIGNATURES },
  ], heliusKey);

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return [];
  }

  const txs = await Promise.all(
    signatures.map((s) =>
      rpc<TransactionResult | null>("getTransaction", [
        s.signature,
        { encoding: "json", maxSupportedTransactionVersion: 0 },
      ], heliusKey).catch(() => null)
    )
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const rows: Position[] = [];

  for (const [protocol, programId] of Object.entries(PROGRAM_IDS) as Array<
    [Protocol, string]
  >) {
    let interactionCount = 0;
    let failedInteractionCount = 0;
    let lastInteractionTs: number | null = null;

    for (const tx of txs) {
      if (!tx?.transaction?.message?.accountKeys) continue;
      const keys = tx.transaction.message.accountKeys.map(accountKeyToString);
      if (!keys.includes(programId)) continue;

      interactionCount += 1;
      const failed = !!tx.meta?.err;
      if (failed) failedInteractionCount += 1;

      const ts = tx.blockTime ?? null;
      if (ts && (!lastInteractionTs || ts > lastInteractionTs)) {
        lastInteractionTs = ts;
      }
    }

    if (interactionCount === 0) continue;

    const hoursSinceLast =
      lastInteractionTs === null ? null : (nowSec - lastInteractionTs) / 3600;
    const { riskLevel, reason } = classifyRisk(
      interactionCount,
      failedInteractionCount,
      hoursSinceLast
    );

    rows.push({
      protocol,
      market: "on-chain activity",
      riskLevel,
      reason,
      interactionCount,
      failedInteractionCount,
      lastInteractionTs,
    });
  }

  return rows;
}

/**
 * Converts live protocol risk signals into actionable alerts.
 */
export function evaluatePositions(
  positions: Position[],
  _warnPct: number
): PositionAlert[] {
  const alerts: PositionAlert[] = [];
  for (const p of positions) {
    if (p.riskLevel === "high") {
      alerts.push({
        position: p,
        severity: "critical",
        message: `CRITICAL: ${p.protocol} shows high-risk behavior. ${p.reason}`,
      });
    } else if (p.riskLevel === "medium") {
      alerts.push({
        position: p,
        severity: "warn",
        message: `Heads up: ${p.protocol} shows medium risk. ${p.reason}`,
      });
    }
  }
  return alerts;
}
