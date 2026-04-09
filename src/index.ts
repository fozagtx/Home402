import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Character,
  type Plugin,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { checkWalletHealthAction } from "./actions/checkWalletHealth.js";
import { monitorPositionsAction } from "./actions/monitorPositions.js";
import { dailyBriefAction } from "./actions/dailyBrief.js";
import { healthRoute } from "./routes/health.js";

// ── Plugin ────────────────────────────────────────────────────────────
// File-local — NOT a named export. ElizaOS CLI's loadProject() treats any
// named export with { name, description } as a plugin and switches into
// plugin-test mode (using a dummy test character), which would throw away
// our real character. Keep this local and expose it only via the Project.

const solSentinelPlugin: Plugin = {
  name: "sol-sentinel",
  description:
    "Personal Solana DeFi watchdog — monitors wallet health and DeFi positions, delivers liquidation alerts and daily briefs.",
  actions: [
    checkWalletHealthAction,
    monitorPositionsAction,
    dailyBriefAction,
  ],
  providers: [],
  evaluators: [],
  routes: [healthRoute],
};

// ── Character ─────────────────────────────────────────────────────────
// Load the character JSON at module init. Using fs + import.meta.url
// instead of a JSON import so this works regardless of the TS module
// resolution mode used by elizaos start / dev.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const characterPath = join(__dirname, "..", "characters", "agent.character.json");
const character = JSON.parse(readFileSync(characterPath, "utf-8")) as Character;

// ── Project export ────────────────────────────────────────────────────
// The ElizaOS CLI's `start` / `dev` commands auto-discover a Project from
// the repo's entry point when `--character` is NOT passed (see
// @elizaos/cli start command source). Exporting a Project here wires
// our custom plugin together with the character.

const solSentinelAgent: ProjectAgent = {
  character,
  plugins: [solSentinelPlugin],
};

const project: Project = {
  agents: [solSentinelAgent],
};

export default project;
