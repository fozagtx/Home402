import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import { fetchWalletSnapshot, formatSnapshot } from "../services/solana.js";

function setting(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  if (typeof v === "string" && v.length > 0) return v;
  return process.env[key] ?? "";
}

function getWallet(runtime: IAgentRuntime, message: Memory): string | null {
  // Prefer explicit pubkey in the message, fall back to configured wallet.
  const text = message.content.text ?? "";
  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (match) return match[0];
  return setting(runtime, "SOLANA_WALLET") || null;
}

function getHeliusKey(runtime: IAgentRuntime): string | null {
  return setting(runtime, "HELIUS_API_KEY") || null;
}

export const checkWalletHealthAction: Action = {
  name: "CHECK_WALLET_HEALTH",
  description:
    "Fetch the current state of a Solana wallet: SOL balance, SPL token count, and USD value. Use this when the user asks about their wallet balance, holdings, or portfolio value.",
  similes: [
    "WALLET_STATUS",
    "CHECK_BALANCE",
    "PORTFOLIO_STATUS",
    "SHOW_WALLET",
    "HEALTH_CHECK",
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    return !!getHeliusKey(runtime);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ) => {
    const heliusKey = getHeliusKey(runtime);
    if (!heliusKey) {
      const text = "HELIUS_API_KEY is not configured.";
      if (callback) await callback({ text });
      return { success: false, text, error: text };
    }

    const wallet = getWallet(runtime, message);
    if (!wallet) {
      const text =
        "No wallet found. Set SOLANA_WALLET in the environment or include a pubkey in your message.";
      if (callback) await callback({ text });
      return { success: false, text, error: text };
    }

    try {
      const snapshot = await fetchWalletSnapshot(wallet, heliusKey);
      const response = `Wallet health check:\n${formatSnapshot(snapshot)}`;
      if (callback) await callback({ text: response });
      return {
        success: true,
        text: response,
        data: { ...snapshot },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Wallet health check failed: ${errorMsg}`;
      if (callback) await callback({ text });
      return { success: false, text, error: errorMsg };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What's my wallet looking like?" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "Pulling the latest on-chain state now.",
          actions: ["CHECK_WALLET_HEALTH"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Check balance for 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
      },
      {
        name: "SolSentinel",
        content: {
          text: "On it.",
          actions: ["CHECK_WALLET_HEALTH"],
        },
      },
    ],
  ],
};
