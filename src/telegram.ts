import { Bot, InlineKeyboard } from "grammy";
import { RealEstateAgent } from "./agent";
import { LLMService } from "./services/ai";
import { MemoryService } from "./services/memory";

const AGENT_PERSONALITY =
  "You are Home402, an autonomous commercial real estate lead hunter. " +
  "You're sharp, casual, and brief — like a real person, not a bot. No corporate speak, no command lists. " +
  "You hunt undervalued commercial properties, verify owners, score deals, and send automated offers using Locus USDC. " +
  "Respond in plain text only. No markdown, no special formatting. Just talk normal.";

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

  private async buildContext(ctx: any, userText: string): Promise<string> {
    const recalled = await this.memory.recall(this.userId(ctx), userText);
    return recalled;
  }

  private async remember(ctx: any, userText: string, botReply: string): Promise<void> {
    const conversation = `user: ${userText}\nassistant: ${botReply}`;
    await this.memory.remember(this.userId(ctx), conversation);
  }

  private async detectIntent(text: string): Promise<Intent> {
    const result = await this.llm.chat(
      "Classify the user's message into exactly one action. Respond with ONLY a JSON object, nothing else.\n" +
      'Actions: search, leads, top, outreach, replies, cycle, balance, report, chat\n\n' +
      'For search, also extract city and state if mentioned.\n' +
      'Examples:\n' +
      '"find me deals in Austin TX" -> {"action":"search","city":"Austin","state":"TX"}\n' +
      '"search miami" -> {"action":"search","city":"Miami","state":"FL"}\n' +
      '"show my leads" -> {"action":"leads"}\n' +
      '"what are the best deals" -> {"action":"top"}\n' +
      '"send offers" -> {"action":"outreach"}\n' +
      '"any replies" -> {"action":"replies"}\n' +
      '"run everything" -> {"action":"cycle"}\n' +
      '"how much money we got" -> {"action":"balance"}\n' +
      '"give me a report" -> {"action":"report"}\n' +
      '"hello" -> {"action":"chat"}\n' +
      '"what can you do" -> {"action":"chat"}',
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

  private async say(ctx: any, msg: string): Promise<void> {
    const escaped = msg.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
    try {
      await ctx.reply(escaped, { parse_mode: "MarkdownV2" });
    } catch {
      await ctx.reply(msg);
    }
  }

  private async thinkOutLoud(ctx: any, thought: string, userText?: string): Promise<void> {
    const context = userText ? await this.buildContext(ctx, userText) : "";
    const systemPrompt = context
      ? `${AGENT_PERSONALITY}\n\nWhat you remember about this user:\n${context}`
      : AGENT_PERSONALITY;
    const reply = await this.llm.chat(systemPrompt, thought);
    const response = reply || "On it...";
    await this.say(ctx, response);
    if (userText) await this.remember(ctx, userText, response);
  }

  private async doSearch(ctx: any, city?: string, state?: string): Promise<void> {
    const config = this.agent.getConfig();
    city = city || config.searchCity;
    state = state || config.searchState;

    await this.thinkOutLoud(ctx, `Tell the user you're hunting properties in ${city}, ${state}. One short sentence, excited tone.`);

    try {
      const leads = await this.agent.searchAndScore({ city, state });

      if (leads.length === 0) {
        await this.thinkOutLoud(ctx, `You searched ${city}, ${state} but came up empty. Tell the user, suggest another area. One sentence.`);
        return;
      }

      const report = this.agent.getLeadManager().generateReport();
      const top = report.topLeads.slice(0, 5);

      let msg = `Found ${leads.length} leads in ${city}, ${state}\n\n`;
      for (const lead of top) {
        const addr = lead.property.address || lead.property.id;
        const val = lead.valueEstimate ? `$${lead.valueEstimate.price.toLocaleString()}` : "N/A";
        const rent = lead.rentalEstimate ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo` : "N/A";
        msg += `Score ${lead.score} | ${addr}\n  Value: ${val} | Rent: ${rent}\n\n`;
      }

      const kb = new InlineKeyboard()
        .text("Full Report", "report")
        .text("Send Offers", "outreach")
        .row()
        .text("Top 10", "top_10");

      try {
        const escaped = msg.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
        await ctx.reply(escaped, { parse_mode: "MarkdownV2", reply_markup: kb });
      } catch {
        await ctx.reply(msg, { reply_markup: kb });
      }
    } catch (err) {
      await this.thinkOutLoud(ctx, `Search in ${city}, ${state} blew up: ${(err as Error).message}. Break it to the user briefly.`);
    }
  }

  private async doLeads(ctx: any): Promise<void> {
    const leads = this.agent.getLeadManager().getAllLeads();
    if (leads.length === 0) {
      await this.thinkOutLoud(ctx, "No leads in the pipeline yet. Tell the user to search first. One sentence.");
      return;
    }

    let msg = `${leads.length} leads in the pipeline\n\n`;
    for (const lead of leads.slice(0, 20)) {
      const addr = lead.property.address || lead.property.id;
      msg += `${lead.score} | ${addr} (${lead.status})\n`;
    }
    await this.say(ctx, msg);
  }

  private async doTop(ctx: any): Promise<void> {
    const report = this.agent.getLeadManager().generateReport();
    const top = report.topLeads.slice(0, 5);

    if (top.length === 0) {
      await this.thinkOutLoud(ctx, "Nothing in the pipeline yet. Tell the user to search first.");
      return;
    }

    let msg = "Top deals:\n\n";
    for (let i = 0; i < top.length; i++) {
      const lead = top[i];
      const addr = lead.property.address || lead.property.id;
      const val = lead.valueEstimate ? `$${lead.valueEstimate.price.toLocaleString()}` : "N/A";
      const rent = lead.rentalEstimate ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo` : "N/A";
      const owner = lead.ownerVerification?.name || "Unknown";
      msg += `${i + 1}. Score ${lead.score} - ${addr}\n   Value: ${val} | Rent: ${rent} | Owner: ${owner}\n\n`;
    }

    const kb = new InlineKeyboard()
      .text("Send Offers", "outreach")
      .text("Full Report", "report");

    try {
      const escaped = msg.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
      await ctx.reply(escaped, { parse_mode: "MarkdownV2", reply_markup: kb });
    } catch {
      await ctx.reply(msg, { reply_markup: kb });
    }
  }

  private async doOutreach(ctx: any): Promise<void> {
    await this.thinkOutLoud(ctx, "Tell the user you're firing off offers to the best leads. One sentence.");

    try {
      const sent = await this.agent.executeOutreach();

      if (sent.length === 0) {
        await this.thinkOutLoud(ctx, "No qualified leads to reach out to. Tell the user they need scored leads above threshold first.");
        return;
      }

      let msg = `Sent ${sent.length} offers:\n\n`;
      for (const lead of sent) {
        const addr = lead.property.address || lead.property.id;
        msg += `${addr} (${lead.outreachMethod || "email"})\n`;
      }
      await this.say(ctx, msg);
    } catch (err) {
      await this.thinkOutLoud(ctx, `Outreach bombed: ${(err as Error).message}. Tell the user briefly.`);
    }
  }

  private async doReplies(ctx: any): Promise<void> {
    await this.thinkOutLoud(ctx, "Tell the user you're checking inbox for owner replies.");

    try {
      const responded = await this.agent.checkReplies();
      if (responded.length === 0) {
        await this.thinkOutLoud(ctx, "No replies yet. Tell the user to check back later.");
        return;
      }

      let msg = `${responded.length} owners replied!\n\n`;
      for (const lead of responded) {
        msg += `${lead.property.address || lead.property.id} - HOT LEAD\n`;
      }
      await this.say(ctx, msg);
    } catch (err) {
      await this.thinkOutLoud(ctx, `Reply check failed: ${(err as Error).message}.`);
    }
  }

  private async doCycle(ctx: any): Promise<void> {
    await this.thinkOutLoud(ctx, "Tell the user you're running the full autonomous cycle: search, score, outreach. Gonna take a sec.");

    try {
      await this.agent.runFullCycle();
      const report = this.agent.getLeadManager().generateReport();

      let msg = `Cycle done.\n`;
      msg += `${report.total} leads | Avg score: ${report.averageScore}\n\n`;
      for (const [status, count] of Object.entries(report.byStatus)) {
        msg += `${status}: ${count}\n`;
      }
      if (report.topLeads.length > 0) {
        msg += "\nBest deals:\n";
        for (const lead of report.topLeads.slice(0, 3)) {
          msg += `  ${lead.score} - ${lead.property.address || lead.property.id}\n`;
        }
      }
      await this.say(ctx, msg);
    } catch (err) {
      await this.thinkOutLoud(ctx, `Full cycle failed: ${(err as Error).message}.`);
    }
  }

  private async doBalance(ctx: any): Promise<void> {
    const balance = await this.agent.getLocus().getBalance();
    if (balance) {
      const addr = balance.wallet_address;
      await this.say(ctx, `Wallet: ${addr.substring(0, 10)}...${addr.substring(addr.length - 6)}\nBalance: ${balance.balance} ${balance.token}`);
    } else {
      await this.thinkOutLoud(ctx, "Can't reach the wallet right now. Tell the user something's off with the Locus connection.");
    }
  }

  private async doReport(ctx: any): Promise<void> {
    const report = this.agent.getLeadManager().generateReport();

    let msg = `Pipeline Report\n\n`;
    msg += `Total: ${report.total} leads\n`;
    msg += `Avg score: ${report.averageScore}\n\n`;
    for (const [status, count] of Object.entries(report.byStatus)) {
      msg += `${status}: ${count}\n`;
    }
    await this.say(ctx, msg);
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
        await this.thinkOutLoud(ctx, userText, userText);
    }
  }

  private setupHandlers(): void {
    this.bot.command("start", async (ctx) => {
      this.chatIds.add(ctx.chat.id);
      await this.thinkOutLoud(ctx, "User just started the bot. Introduce yourself as Home402. You hunt commercial real estate deals autonomously. What you do: search properties, score them, send offers, check replies. Brief, casual.", "/start");
    });

    this.bot.command("help", async (ctx) => {
      await this.thinkOutLoud(ctx, "User wants to know what you can do. Just tell them conversationally - you can search for deals, show leads, send offers, check replies, run full cycles, check balance, give reports. No command list, just talk.", "/help");
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
        msg += `${i + 1}. ${leads[i].score} - ${addr}\n`;
      }
      await this.say(ctx, msg);
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
