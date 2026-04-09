// Daily-brief scheduler.
//
// ElizaOS doesn't give us a cron primitive, so we roll a tiny one: compute
// the ms until the next DAILY_BRIEF_HOUR_UTC, fire once, then re-schedule
// every 24h. At fire time we invoke the DAILY_BRIEF action directly and
// push the resulting text into the user's Telegram chat via the running
// plugin-telegram service.

import { type IAgentRuntime, type Memory, logger } from "@elizaos/core";
import { dailyBriefAction } from "../actions/dailyBrief.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function setting(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  if (typeof v === "string" && v.length > 0) return v;
  return process.env[key] ?? "";
}

function getBriefHourUtc(runtime: IAgentRuntime): number | null {
  const raw = setting(runtime, "DAILY_BRIEF_HOUR_UTC");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 23) return null;
  return Math.floor(n);
}

function getDailyBriefChatId(runtime: IAgentRuntime): string | null {
  // The first entry of TELEGRAM_ALLOWED_CHATS is the "owner" chat and
  // the target for pushes. Keeps us from adding a second env var.
  const raw = setting(runtime, "TELEGRAM_ALLOWED_CHATS");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return String(parsed[0]);
    }
  } catch {
    /* fall through */
  }
  return null;
}

function msUntilNextUtcHour(hour: number, now: Date = new Date()): number {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      0,
      0,
      0
    )
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Runs the DAILY_BRIEF action and returns its text, without needing a
 * real user message. The handler ignores the message argument so a
 * minimal synthetic Memory is enough.
 */
async function runDailyBrief(runtime: IAgentRuntime): Promise<string | null> {
  let captured: string | null = null;
  const syntheticMessage = {
    id: "00000000-0000-0000-0000-000000000000",
    entityId: runtime.agentId,
    agentId: runtime.agentId,
    roomId: "00000000-0000-0000-0000-000000000000",
    content: { text: "", source: "scheduler" },
    createdAt: Date.now(),
  } as unknown as Memory;

  const result = await dailyBriefAction.handler(
    runtime,
    syntheticMessage,
    undefined,
    undefined,
    async (content) => {
      if (content && typeof content.text === "string") {
        captured = content.text;
      }
      return [];
    }
  );

  if (captured) return captured;
  if (
    result &&
    typeof result === "object" &&
    "text" in result &&
    typeof (result as { text?: unknown }).text === "string"
  ) {
    return (result as { text: string }).text;
  }
  return null;
}

async function sendViaTelegram(
  runtime: IAgentRuntime,
  chatId: string,
  text: string
): Promise<boolean> {
  const tg = runtime.getService("telegram") as
    | { messageManager?: { sendMessage: (chatId: string, content: { text: string }) => Promise<unknown> } }
    | null;
  if (!tg?.messageManager) {
    logger.warn(
      { src: "solsentinel:scheduler" },
      "Telegram service not available — skipping daily brief push"
    );
    return false;
  }
  await tg.messageManager.sendMessage(chatId, { text });
  return true;
}

export function startDailyBriefScheduler(runtime: IAgentRuntime): () => void {
  const hour = getBriefHourUtc(runtime);
  if (hour === null) {
    logger.info(
      { src: "solsentinel:scheduler" },
      "DAILY_BRIEF_HOUR_UTC not set — scheduler disabled"
    );
    return () => {};
  }

  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;
  let interval: NodeJS.Timeout | null = null;

  const fire = async () => {
    if (stopped) return;
    try {
      const chatId = getDailyBriefChatId(runtime);
      if (!chatId) {
        logger.warn(
          { src: "solsentinel:scheduler" },
          "No TELEGRAM_ALLOWED_CHATS target — cannot push daily brief"
        );
        return;
      }
      const text = await runDailyBrief(runtime);
      if (!text) {
        logger.warn(
          { src: "solsentinel:scheduler" },
          "Daily brief produced no text — nothing to send"
        );
        return;
      }
      const ok = await sendViaTelegram(runtime, chatId, text);
      if (ok) {
        logger.info(
          { src: "solsentinel:scheduler", chatId },
          "Daily brief delivered"
        );
      }
    } catch (err) {
      logger.error(
        {
          src: "solsentinel:scheduler",
          error: err instanceof Error ? err.message : String(err),
        },
        "Daily brief scheduler tick failed"
      );
    }
  };

  const delay = msUntilNextUtcHour(hour);
  logger.info(
    {
      src: "solsentinel:scheduler",
      hourUtc: hour,
      firstRunInMinutes: Math.round(delay / 60000),
    },
    "Daily brief scheduler armed"
  );

  timeout = setTimeout(() => {
    void fire();
    interval = setInterval(() => void fire(), ONE_DAY_MS);
  }, delay);

  return () => {
    stopped = true;
    if (timeout) clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}
