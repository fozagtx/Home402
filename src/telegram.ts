import { Bot, InlineKeyboard } from "grammy";
import { RealEstateAgent } from "./agent";
import { LLMService } from "./services/ai";
import { MemoryService } from "./services/memory";

const AGENT_PERSONALITY =
  "You are Home402, an autonomous commercial real estate lead hunter. " +
  "Sharp, casual, brief. Like a real person, not a bot. " +
  "You hunt undervalued commercial properties, verify owners, score deals, and send automated offers using Locus USDC. " +
  "Your email is home402-hunter@agentmail.to. " +
  "Respond in plain text. No markdown. No command lists.";

type Intent =
  | { action: "search"; city?: string; state?: string }
  | { action: "leads" }
  | { action: "top" }
  | { action: "outreach" }
  | { action: "replies" }
  | { action: "cycle" }
  | { action: "balance" }
  | { action: "report" }
  | { action: "chat" };

export class TelegramBot {
  private bot: Bot;
  private agent: RealEstateAgent;
  private llm: LLMService;
  private memory: MemoryService;
  private chatIds: Set<number> = new Set();

  constructor(token: string, agent: RealEstateAgent) {
    this.bot = new Bot(token);
    this.agent = agent;
    this.llm = agent.getLLM();
    this.memory = agent.getMemory();

    this.bot.catch((err) => {
      console.error("Telegram error:", err.message);
    });

    this.setupHandlers();
  }

  private userId(ctx: any): string {
    return `tg_${ctx.chat?.id || "unknown"}`;
  }

  private async detectIntent(text: string): Promise<Intent> {
    const result = await this.llm.chat(
      "Classify the user message into ONE action. ONLY JSON. No other text.\n" +
      'Actions: search, leads, top, outreach, replies, cycle, balance, report, chat\n\n' +
      '"find deals Austin TX" -> {"action":"search","city":"Austin","state":"TX"}\n' +
      '"search miami" -> {"action":"search","city":"Miami","state":"FL"}\n' +
      '"show leads" -> {"action":"leads"}\n' +
      '"best deals" -> {"action":"top"}\n' +
      '"send offers" -> {"action":"outreach"}\n' +
      '"any replies" -> {"action":"replies"}\n' +
      '"run everything" -> {"action":"cycle"}\n' +
      '"how much money" -> {"action":"balance"}\n' +
      '"report" -> {"action":"report"}\n' +
      '"hello" -> {"action":"chat"}',
      text
    );

    if (!result) return { action: "chat" };

    try {
      const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.action && parsed.action !== "chat") return parsed as Intent;
    } catch {}

    return { action: "chat" };
  }

  private async send(ctx: any, msg: string, keyboard?: InlineKeyboard): Promise<void> {
    const escaped = msg.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
    const opts: any = { parse_mode: "MarkdownV2" };
    if (keyboard) opts.reply_markup = keyboard;
    try {
      await ctx.reply(escaped, opts);
    } catch {
      await ctx.reply(msg);
    }
  }

  private async chat(ctx: any, userText: string): Promise<void> {
    const context = await this.memory.recall(this.userId(ctx), userText);
    const system = context
      ? `${AGENT_PERSONALITY}\n\nRelevant context:\n${context}`
      : AGENT_PERSONALITY;

    const reply = await this.llm.chat(system, userText);
    const response = reply || "Hmm, something broke. Try again.";

    try {
      const escaped = response.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
      await ctx.reply(escaped, { parse_mode: "MarkdownV2" });
    } catch {
      await ctx.reply(response);
    }

    await this.memory.remember(this.userId(ctx), `user: ${userText}\nbot: ${response}`);
  }

  private async doSearch(ctx: any, city?: string, state?: string): Promise<void> {
    const config = this.agent.getConfig();
    city = city || config.searchCity;
    state = state || config.searchState;

    await this.send(ctx, `Hunting properties in ${city}, ${state}...`);

    try {
      const leads = await this.agent.searchAndScore({ city, state });

      if (leads.length === 0) {
        await this.send(ctx, `No results for ${city}, ${state}. The Locus/RentCast API may be temporarily down (502s are common). Try again in a minute, or try another city like Tampa, Orlando, or Austin.`);
        return;
      }

      const report = this.agent.getLeadManager().generateReport();
      const top = report.topLeads.slice(0, 5);

      let msg = `Found ${leads.length} properties in ${city}, ${state}\n\n`;
      for (let i = 0; i < top.length; i++) {
        const lead = top[i];
        const addr = lead.property.address || lead.property.id;
        const val = lead.valueEstimate ? `$${lead.valueEstimate.price.toLocaleString()}` : "N/A";
        const rent = lead.rentalEstimate ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo` : "N/A";
        msg += `${i + 1}. Score ${lead.score}/100 - ${addr}\n   Value: ${val} | Rent: ${rent}\n\n`;
      }

      const kb = new InlineKeyboard()
        .text("Full Report", "report")
        .text("Send Offers", "outreach")
        .row()
        .text("Top 10", "top_10");

      await this.send(ctx, msg, kb);
    } catch (err) {
      await this.send(ctx, `Search failed: ${(err as Error).message}`);
    }
  }

  private async doLeads(ctx: any): Promise<void> {
    const leads = this.agent.getLeadManager().getAllLeads();
    if (leads.length === 0) {
      await this.send(ctx, "No leads yet. Say 'search Miami FL' or /search to start hunting.");
      return;
    }

    let msg = `${leads.length} leads in pipeline:\n\n`;
    for (let i = 0; i < Math.min(leads.length, 20); i++) {
      const addr = leads[i].property.address || leads[i].property.id;
      msg += `${leads[i].score}/100 | ${addr} (${leads[i].status})\n`;
    }
    await this.send(ctx, msg);
  }

  private async doTop(ctx: any): Promise<void> {
    const report = this.agent.getLeadManager().generateReport();
    const top = report.topLeads.slice(0, 5);

    if (top.length === 0) {
      await this.send(ctx, "No leads yet. Search first.");
      return;
    }

    let msg = "Top deals:\n\n";
    for (let i = 0; i < top.length; i++) {
      const lead = top[i];
      const addr = lead.property.address || lead.property.id;
      const val = lead.valueEstimate ? `$${lead.valueEstimate.price.toLocaleString()}` : "N/A";
      const rent = lead.rentalEstimate ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo` : "N/A";
      const owner = lead.ownerVerification?.name || "Unknown";
      msg += `${i + 1}. Score ${lead.score}/100 - ${addr}\n   Value: ${val} | Rent: ${rent} | Owner: ${owner}\n\n`;
    }

    const kb = new InlineKeyboard()
      .text("Send Offers", "outreach")
      .text("Full Report", "report");

    await this.send(ctx, msg, kb);
  }

  private async doOutreach(ctx: any): Promise<void> {
    await this.send(ctx, "Sending offers to qualified leads...");

    try {
      const sent = await this.agent.executeOutreach();

      if (sent.length === 0) {
        await this.send(ctx, "No leads qualified for outreach. Need scored leads above threshold first.");
        return;
      }

      let msg = `Sent ${sent.length} offers:\n\n`;
      for (const lead of sent) {
        const addr = lead.property.address || lead.property.id;
        msg += `${addr} via ${lead.outreachMethod || "email"}\n`;
      }
      await this.send(ctx, msg);
    } catch (err) {
      await this.send(ctx, `Outreach failed: ${(err as Error).message}`);
    }
  }

  private async doReplies(ctx: any): Promise<void> {
    await this.send(ctx, "Checking inbox for owner replies...");

    try {
      const responded = await this.agent.checkReplies();
      if (responded.length === 0) {
        await this.send(ctx, "No new replies yet. Check back later.");
        return;
      }

      let msg = `${responded.length} owners replied!\n\n`;
      for (const lead of responded) {
        msg += `${lead.property.address || lead.property.id} - HOT LEAD\n`;
      }
      await this.send(ctx, msg);
    } catch (err) {
      await this.send(ctx, `Reply check failed: ${(err as Error).message}`);
    }
  }

  private async doCycle(ctx: any): Promise<void> {
    await this.send(ctx, "Running full cycle: search -> score -> outreach...");

    try {
      await this.agent.runFullCycle();
      const report = this.agent.getLeadManager().generateReport();

      let msg = `Cycle complete.\n`;
      msg += `${report.total} leads | Avg score: ${report.averageScore}/100\n\n`;
      for (const [status, count] of Object.entries(report.byStatus)) {
        msg += `${status}: ${count}\n`;
      }
      if (report.topLeads.length > 0) {
        msg += "\nBest deals:\n";
        for (const lead of report.topLeads.slice(0, 3)) {
          msg += `  ${lead.score}/100 - ${lead.property.address || lead.property.id}\n`;
        }
      }
      await this.send(ctx, msg);
    } catch (err) {
      await this.send(ctx, `Cycle failed: ${(err as Error).message}`);
    }
  }

  private async doBalance(ctx: any): Promise<void> {
    const balance = await this.agent.getLocus().getBalance();
    if (balance) {
      const addr = balance.wallet_address;
      await this.send(ctx, `Wallet: ${addr.substring(0, 10)}...${addr.substring(addr.length - 6)}\nBalance: ${balance.balance} ${balance.token}`);
    } else {
      await this.send(ctx, "Can't reach wallet. Locus connection issue.");
    }
  }

  private async doReport(ctx: any): Promise<void> {
    const report = this.agent.getLeadManager().generateReport();

    let msg = `Pipeline Report\n\n`;
    msg += `Total: ${report.total} leads\n`;
    msg += `Avg score: ${report.averageScore}/100\n\n`;
    for (const [status, count] of Object.entries(report.byStatus)) {
      msg += `${status}: ${count}\n`;
    }
    await this.send(ctx, msg);
  }

  private async handleIntent(ctx: any, intent: Intent, userText: string): Promise<void> {
    switch (intent.action) {
      case "search":
        await this.doSearch(ctx, (intent as any).city, (intent as any).state);
        break;
      case "leads":
        await this.doLeads(ctx);
        break;
      case "top":
        await this.doTop(ctx);
        break;
      case "outreach":
        await this.doOutreach(ctx);
        break;
      case "replies":
        await this.doReplies(ctx);
        break;
      case "cycle":
        await this.doCycle(ctx);
        break;
      case "balance":
        await this.doBalance(ctx);
        break;
      case "report":
        await this.doReport(ctx);
        break;
      default:
        await this.chat(ctx, userText);
    }
  }

  private setupHandlers(): void {
    this.bot.command("start", async (ctx) => {
      this.chatIds.add(ctx.chat.id);
      await this.chat(ctx, "User just started. Introduce yourself as Home402 briefly.");
    });

    this.bot.command("help", async (ctx) => {
      await this.chat(ctx, "User wants to know what you can do. Tell them conversationally and briefly.");
    });

    this.bot.command("search", async (ctx) => {
      const text = ctx.message?.text || "";
      const parts = text.trim().split(/\s+/);
      const city = parts.length >= 3 ? parts[1] : undefined;
      const state = parts.length >= 3 ? parts[2].toUpperCase() : undefined;
      await this.doSearch(ctx, city, state);
    });

    this.bot.command("leads", async (ctx) => { await this.doLeads(ctx); });
    this.bot.command("top", async (ctx) => { await this.doTop(ctx); });
    this.bot.command("outreach", async (ctx) => { await this.doOutreach(ctx); });
    this.bot.command("replies", async (ctx) => { await this.doReplies(ctx); });
    this.bot.command("cycle", async (ctx) => { await this.doCycle(ctx); });
    this.bot.command("balance", async (ctx) => { await this.doBalance(ctx); });
    this.bot.command("report", async (ctx) => { await this.doReport(ctx); });

    this.bot.callbackQuery("report", async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.doReport(ctx);
    });

    this.bot.callbackQuery("outreach", async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.doOutreach(ctx);
    });

    this.bot.callbackQuery("top_10", async (ctx) => {
      await ctx.answerCallbackQuery();
      const leads = this.agent.getLeadManager().getAllLeads().slice(0, 10);
      let msg = "Top 10:\n\n";
      for (let i = 0; i < leads.length; i++) {
        const addr = leads[i].property.address || leads[i].property.id;
        msg += `${i + 1}. ${leads[i].score}/100 - ${addr}\n`;
      }
      await this.send(ctx, msg);
    });

    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message?.text || "";
      const intent = await this.detectIntent(text);
      await this.handleIntent(ctx, intent, text);
    });
  }

  async start(): Promise<void> {
    console.log("Starting Telegram bot...");
    try {
      await this.bot.start({
        onStart: (info) => {
          console.log(`Telegram bot @${info.username} is running`);
        },
      });
    } catch (err) {
      console.error(`Telegram fatal: ${(err as Error).message}`);
      throw err;
    }
  }

  stop(): void {
    this.bot.stop();
    console.log("Telegram bot stopped");
  }
}
