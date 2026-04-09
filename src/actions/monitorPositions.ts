import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import {
  fetchPositions,
  evaluatePositions,
  PositionsUnavailableError,
} from "../services/positions.js";

function setting(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  if (typeof v === "string" && v.length > 0) return v;
  return process.env[key] ?? "";
}

function getWallet(runtime: IAgentRuntime): string {
  return setting(runtime, "SOLANA_WALLET");
}

function getWarnPct(runtime: IAgentRuntime): number {
  const raw = setting(runtime, "LIQUIDATION_WARN_PCT") || "15";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export const monitorPositionsAction: Action = {
  name: "MONITOR_POSITIONS",
  description:
    "Scan the user's Solana DeFi risk signals (Kamino, MarginFi, Drift) from live on-chain activity and report medium/high risk warnings. Use this when the user asks about leveraged positions, liquidation risk, or DeFi health.",
  similes: [
    "CHECK_POSITIONS",
    "LIQUIDATION_RISK",
    "DEFI_HEALTH",
    "SCAN_POSITIONS",
    "POSITION_STATUS",
  ],
  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ) => {
    const wallet = getWallet(runtime);
    if (!wallet) {
      const text = "SOLANA_WALLET is not configured.";
      if (callback) await callback({ text });
      return { success: false, text, error: text };
    }

    try {
      const positions = await fetchPositions(wallet);
      if (positions.length === 0) {
        const text = "No open DeFi positions found.";
        if (callback) await callback({ text });
        return { success: true, text, data: { positions: [], alerts: [] } };
      }

      const warnPct = getWarnPct(runtime);
      const alerts = evaluatePositions(positions, warnPct);

      const summary = positions
        .map(
          (p) =>
            `• ${p.protocol} ${p.market} — risk ${p.riskLevel.toUpperCase()} ` +
            `(${p.interactionCount} recent tx, ${p.failedInteractionCount} failed)`
        )
        .join("\n");

      const alertSection =
        alerts.length === 0
          ? "All positions are outside the danger zone."
          : alerts.map((a) => `⚠️ ${a.message}`).join("\n");

      const response = `Positions for ${wallet.slice(0, 4)}...${wallet.slice(-4)}:\n${summary}\n\n${alertSection}`;
      if (callback) await callback({ text: response });
      return {
        success: true,
        text: response,
        data: { positions, alerts },
      };
    } catch (err) {
      if (err instanceof PositionsUnavailableError) {
        const text =
          "Live DeFi risk scanning is unavailable right now. " +
          "Check HELIUS_API_KEY and RPC connectivity, then retry.";
        if (callback) await callback({ text });
        return { success: false, text, error: err.message };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Position check failed: ${errorMsg}`;
      if (callback) await callback({ text });
      return { success: false, text, error: errorMsg };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Am I about to get liquidated?" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "Scanning your positions now.",
          actions: ["MONITOR_POSITIONS"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "How are my Kamino positions?" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "Let me check.",
          actions: ["MONITOR_POSITIONS"],
        },
      },
    ],
  ],
};
