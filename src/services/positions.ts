// DeFi position source for SolSentinel.
//
// MVP: returns mock positions so the hackathon demo is deterministic.
// Post-hackathon: real Kamino / MarginFi / Drift SDK adapters live here.
// Toggle with MOCK_POSITIONS=false once the real adapters ship.

export type Protocol = "kamino" | "marginfi" | "drift";

export interface Position {
  protocol: Protocol;
  market: string;
  leverage: number;
  /** 1.0 = at liquidation, higher = safer. */
  healthFactor: number;
  collateralUsd: number;
  debtUsd: number;
}

export interface PositionAlert {
  position: Position;
  severity: "warn" | "critical";
  message: string;
}

const DEMO_POSITIONS: Position[] = [
  {
    protocol: "kamino",
    market: "SOL/USDC",
    leverage: 1.8,
    healthFactor: 1.15,
    collateralUsd: 5200,
    debtUsd: 2900,
  },
  {
    protocol: "marginfi",
    market: "JUP",
    leverage: 1.2,
    healthFactor: 1.85,
    collateralUsd: 800,
    debtUsd: 150,
  },
];

export async function fetchPositions(wallet: string): Promise<Position[]> {
  if (process.env.MOCK_POSITIONS !== "false") {
    return DEMO_POSITIONS;
  }
  // Real adapters land post-hackathon. See roadmap in README.
  throw new Error(
    `Real on-chain position adapters not yet implemented for wallet ${wallet}. ` +
      `Set MOCK_POSITIONS=true for the demo.`
  );
}

/**
 * Returns an alert for every position whose health factor is within
 * `warnPct` percent of liquidation (1.0). Critical once inside 5%.
 */
export function evaluatePositions(
  positions: Position[],
  warnPct: number
): PositionAlert[] {
  const warnThreshold = 1 + warnPct / 100;
  const criticalThreshold = 1.05;
  const alerts: PositionAlert[] = [];
  for (const p of positions) {
    if (p.healthFactor <= criticalThreshold) {
      alerts.push({
        position: p,
        severity: "critical",
        message:
          `CRITICAL: ${p.protocol} ${p.market} position at ${p.leverage}x ` +
          `is ${((p.healthFactor - 1) * 100).toFixed(1)}% from liquidation. ` +
          `Collateral $${p.collateralUsd.toFixed(0)}, debt $${p.debtUsd.toFixed(0)}.`,
      });
    } else if (p.healthFactor <= warnThreshold) {
      alerts.push({
        position: p,
        severity: "warn",
        message:
          `Heads up: ${p.protocol} ${p.market} position at ${p.leverage}x ` +
          `is ${((p.healthFactor - 1) * 100).toFixed(1)}% from liquidation.`,
      });
    }
  }
  return alerts;
}
