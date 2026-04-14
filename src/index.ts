import "dotenv/config";
import { RealEstateAgent } from "./agent";
import { TelegramBot } from "./telegram";
import { AgentConfig } from "./types";

function loadConfig(): AgentConfig {
  const apiKey = process.env.LOCUS_API_KEY;
  if (!apiKey) {
    console.error("LOCUS_API_KEY is required");
    process.exit(1);
  }

  return {
    locusApiKey: apiKey,
    locusApiBase:
      process.env.LOCUS_API_BASE || "https://api.paywithlocus.com/api",
    searchCity: process.env.SEARCH_CITY || "Miami",
    searchState: process.env.SEARCH_STATE || "FL",
    searchPropertyType: process.env.SEARCH_PROPERTY_TYPE || "Multi-Family",
    searchRadius: parseInt(process.env.SEARCH_RADIUS || "10", 10),
    leadScoreThreshold: parseInt(
      process.env.LEAD_SCORE_THRESHOLD || "70",
      10
    ),
    agentmailUsername: process.env.AGENTMAIL_USERNAME || "home402-hunter",
    twitterHandle: process.env.TWITTER_HANDLE || "home402_agent",
  };
}

async function main() {
  const config = loadConfig();
  const agent = new RealEstateAgent(config);

  const ok = await agent.init();
  if (!ok) {
    console.error("Agent initialization failed");
    process.exit(1);
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    const bot = new TelegramBot(telegramToken, agent);
    await bot.start();
  } else {
    console.log("No TELEGRAM_BOT_TOKEN set. Running single cycle...");
    await agent.runFullCycle();
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
