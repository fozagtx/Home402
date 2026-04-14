# Home402 — Autonomous Commercial Real Estate Lead Hunter

An AI agent that hunts undervalued commercial properties, verifies owners, sends automated offers, and only surfaces leads to you when the owner responds — all paid per-use through [Locus](https://paywithlocus.com) USDC on Base.

## How It Works

```
1. SEARCH    → RentCast + Mapbox find undervalued commercial properties
2. ENRICH    → Property values, rental estimates, market stats
3. VERIFY    → Whitepages Pro / Abstract API confirm owner identity
4. PROFILE   → BuiltWith detects business tech stacks
5. SCORE     → Multi-signal lead scoring (value gap, cap rate, owner validity)
6. OUTREACH  → AgentMail sends offers automatically
7. NOTIFY    → You only hear back when the owner responds
```

**Locus pays every data provider per hit.** You fund one USDC wallet, set spending limits, and the agent handles the rest.

## Architecture

```
src/
├── index.ts                    Entry point (CLI or Telegram bot)
├── agent.ts                    Orchestrator: search → diligence → score → outreach
├── telegram.ts                 Telegram bot with inline controls
├── types.ts                    All TypeScript types & enums
└── services/
    ├── locus.ts                Locus API client (wallet, wrapped APIs, x402)
    ├── propertySearch.ts       RentCast + Mapbox property hunting
    ├── dueDiligence.ts         Whitepages Pro + Abstract API + BuiltWith
    ├── outreach.ts             AgentMail email outreach
    └── leadManager.ts          Lead lifecycle, scoring, reporting
```

## Locus Integration

Every external API call goes through Locus wrapped APIs — no separate accounts or API keys needed:

| Service | Purpose | Cost/call |
|---------|---------|-----------|
| **RentCast** | Property records, AVM valuations, rent estimates, market stats | ~$0.033 |
| **Mapbox** | Geocoding, static maps, spatial queries | ~$0.004 |
| **Whitepages Pro** | Owner identity verification, reverse lookup | ~$0.055 |
| **Abstract API** | Email validation fallback | ~$0.015 |
| **BuiltWith** | Business tech stack profiling | ~$0.055 |
| **AgentMail** | Agent email inbox (x402) | ~$2.00 inbox, ~$0.01/email |

## Setup

### Prerequisites

- Node.js 18+
- A [Locus](https://app.paywithlocus.com) account with USDC on Base
- A [Telegram Bot Token](https://t.me/BotFather) (optional, for bot mode)

### Install

```bash
git clone https://github.com/fozagtx/Home402.git
cd Home402
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
LOCUS_API_KEY=claw_dev_your_key_here
LOCUS_API_BASE=https://api.paywithlocus.com/api

SEARCH_CITY=Miami
SEARCH_STATE=FL
SEARCH_PROPERTY_TYPE=Multi-Family
SEARCH_RADIUS=10

LEAD_SCORE_THRESHOLD=70
AGENTMAIL_USERNAME=home402-hunter

TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

### Run

```bash
# Build
npm run build

# Start with Telegram bot
npm start

# Or run a single cycle without Telegram
LOCUS_API_KEY=claw_dev_xxx node dist/index.js
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + command list |
| `/search` | Search properties in default area |
| `/search Miami FL` | Search a custom city/state |
| `/leads` | Show all scored leads |
| `/top` | Top 5 highest-scored leads |
| `/outreach` | Send offers to qualified leads |
| `/replies` | Check for owner email replies |
| `/cycle` | Full automated cycle (search → score → outreach) |
| `/balance` | Check Locus USDC wallet balance |
| `/report` | Pipeline report with status breakdown |

## Lead Scoring

Leads are scored 0–100 based on:

| Signal | Max Points |
|--------|------------|
| Value gap (market vs. last sale) | 25 |
| Cap rate (rent/market value) | 20 |
| Owner identity verified | 15 |
| Owner has reachable email | 10 |
| High-confidence AVM | 10 |
| Low owner risk score (<30) | 5 |
| Business tech spend >$1k | 5 |
| Fast-moving market (<30 DOM) | 5 |

Only leads above `LEAD_SCORE_THRESHOLD` (default 70) get automated outreach.

## Testing

```bash
npm test
```

## License

MIT
