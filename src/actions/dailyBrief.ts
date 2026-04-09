import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import { fetchWalletSnapshot } from "../services/solana.js";
import {
  fetchPositions,
  evaluatePositions,
  PositionsUnavailableError,
  type Position,
} from "../services/positions.js";

function setting(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  if (typeof v === "string" && v.length > 0) return v;
  return process.env[key] ?? "";
}

function getWallet(runtime: IAgentRuntime): string {
  return setting(runtime, "SOLANA_WALLET");
}

function getHeliusKey(runtime: IAgentRuntime): string {
  return setting(runtime, "HELIUS_API_KEY");
}

export const dailyBriefAction: Action = {
  name: "DAILY_BRIEF",
  description:
    "Produce a concise morning brief summarizing the user's Solana wallet state, open DeFi positions, and any overnight risks. Use this when the user asks for a summary, daily brief, or morning update.",
  similes: [
    "MORNING_BRIEF",
    "DAILY_SUMMARY",
    "PORTFOLIO_SUMMARY",
    "OVERNIGHT_UPDATE",
    "DAILY_UPDATE",
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    return !!getHeliusKey(runtime) && !!getWallet(runtime);
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ) => {
    const wallet = getWallet(runtime);
    const heliusKey = getHeliusKey(runtime);
    if (!wallet || !heliusKey) {
      const text = "SOLANA_WALLET and HELIUS_API_KEY must both be configured.";
      if (callback) await callback({ text });
      return { success: false, text, error: text };
    }

    try {
      const snapshot = await fetchWalletSnapshot(wallet, heliusKey);

      // Positions are best-effort: if the on-chain adapters aren't wired
      // up yet the brief degrades gracefully to wallet-only instead of
      // reporting fabricated data.
      let positions: Position[] = [];
      let positionsAvailable = true;
      try {
        positions = await fetchPositions(wallet);
      } catch (err) {
        if (err instanceof PositionsUnavailableError) {
          positionsAvailable = false;
        } else {
          throw err;
        }
      }

      const alerts = positionsAvailable ? evaluatePositions(positions, 15) : [];
      const highRiskCount = positions.filter((p) => p.riskLevel === "high").length;

      // Deterministic 3-sentence brief. Keeping this synchronous and
      // string-based instead of delegating to the LLM makes the demo
      // 100% reliable, which matters more than prose quality here.
      const line1 = `Good morning. Wallet holds ${snapshot.solBalance.toFixed(
        2
      )} SOL (~$${snapshot.totalUsd.toFixed(0)}) at $${snapshot.solPriceUsd.toFixed(
        2
      )}/SOL and ${snapshot.tokens.length} SPL tokens.`;

      const line2 = !positionsAvailable
        ? "DeFi position scanning is not wired up yet, so this brief only covers wallet balance."
        : positions.length === 0
          ? "No open DeFi positions."
          : `You have ${positions.length} active DeFi protocol exposure${positions.length === 1 ? "" : "s"} ` +
            `across ${new Set(positions.map((p) => p.protocol)).size} protocol${
              new Set(positions.map((p) => p.protocol)).size === 1 ? "" : "s"
            }; ${highRiskCount} high-risk signal${highRiskCount === 1 ? "" : "s"} detected.`;

      const line3 = !positionsAvailable
        ? "No DeFi risk alerts can be generated until live scanning is available."
        : alerts.length === 0
          ? "Nothing requires your attention right now."
          : `${alerts.length} position${alerts.length === 1 ? "" : "s"} need${
              alerts.length === 1 ? "s" : ""
            } attention: ${alerts[0].message}`;

      const response = [line1, line2, line3].join(" ");
      if (callback) await callback({ text: response });
      return {
        success: true,
        text: response,
        data: {
          solBalance: snapshot.solBalance,
          totalUsd: snapshot.totalUsd,
          positionsAvailable,
          positionCount: positions.length,
          alertCount: alerts.length,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Daily brief failed: ${errorMsg}`;
      if (callback) await callback({ text });
      return { success: false, text, error: errorMsg };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Give me my morning brief" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "Pulling everything together now.",
          actions: ["DAILY_BRIEF"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "What happened overnight?" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "Here's the summary.",
          actions: ["DAILY_BRIEF"],
        },
      },
    ],
  ],
};
