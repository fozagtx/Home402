import { Bot, InlineKeyboard, GrammyError } from "grammy";
import { RealEstateAgent } from "./agent";
import { LeadStatus } from "./types";

export class TelegramBot {
  private bot: Bot;
  private agent: RealEstateAgent;
  private chatIds: Set<number> = new Set();

  constructor(token: string, agent: RealEstateAgent) {
    this.bot = new Bot(token);
    this.agent = agent;

    this.setupCommands();
    this.setupHandlers();
  }

  private setupCommands(): void {
    this.bot.command("start", async (ctx) => {
      this.chatIds.add(ctx.chat.id);
      await ctx.reply(
        "🏗 *Home402 — Autonomous Commercial RE Lead Hunter*\n\n" +
          "I hunt undervalued commercial properties, verify owners, and send automated offers — all paid via Locus USDC.\n\n" +
          "*Commands:*\n" +
          "/search — Run property search in configured area\n" +
          "/search \\[city] \\[state] — Search a custom area\n" +
          "/leads — Show all scored leads\n" +
          "/top — Show top 5 leads\n" +
          "/outreach — Send offers to high\\-scoring leads\n" +
          "/replies — Check for owner replies\n" +
          "/cycle — Run full cycle \\(search → score → outreach\\)\n" +
          "/balance — Check Locus wallet balance\n" +
          "/report — Generate lead pipeline report\n" +
          "/help — Show this message",
        { parse_mode: "MarkdownV2" }
      );
    });

    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        "*Home402 Commands:*\n\n" +
          "/search — Search properties \\(default area\\)\n" +
          "/search Miami FL — Custom city/state\n" +
          "/leads — All leads with scores\n" +
          "/top — Top 5 highest scored leads\n" +
          "/outreach — Send offers to qualified leads\n" +
          "/replies — Check for owner email replies\n" +
          "/cycle — Full automated cycle\n" +
          "/balance — Locus USDC balance\n" +
          "/report — Pipeline report",
        { parse_mode: "MarkdownV2" }
      );
    });
  }

  private setupHandlers(): void {
    this.bot.command("balance", async (ctx) => {
      await ctx.reply("Checking Locus wallet...");
      const balance = await this.agent.getLocus().getBalance();
      if (balance) {
        await ctx.reply(
          `💰 *Wallet Balance*\n\n` +
            `Address: \`${balance.wallet_address.substring(0, 10)}...${balance.wallet_address.substring(balance.wallet_address.length - 6)}\`\n` +
            `Balance: *${balance.balance} ${balance.token}*`,
          { parse_mode: "MarkdownV2" }
        );
      } else {
        await ctx.reply("❌ Failed to fetch balance.");
      }
    });

    this.bot.command("search", async (ctx) => {
      const text = ctx.message?.text || "";
      const parts = text.trim().split(/\s+/);
      const config = this.agent.getConfig();

      let city = config.searchCity;
      let state = config.searchState;

      if (parts.length >= 3) {
        city = parts[1];
        state = parts[2].toUpperCase();
      }

      await ctx.reply(
        `🔍 Searching for undervalued properties in *${city}, ${state}*\\.\\.\\.`,
        { parse_mode: "MarkdownV2" }
      );

      try {
        const leads = await this.agent.searchAndScore({
          city,
          state,
        });

        if (leads.length === 0) {
          await ctx.reply("No properties found.");
          return;
        }

        const report = this.agent.getLeadManager().generateReport();
        const top = report.topLeads.slice(0, 5);

        let msg = `✅ *Found ${leads.length} leads*\n\n`;
        for (const lead of top) {
          const addr = lead.property.address || lead.property.id;
          const val = lead.valueEstimate
            ? `$${lead.valueEstimate.price.toLocaleString()}`
            : "N/A";
          const rent = lead.rentalEstimate
            ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo`
            : "N/A";
          msg += `*Score: ${lead.score}* | ${addr}\n`;
          msg += `  Value: ${val} | Rent: ${rent}\n\n`;
        }

        const kb = new InlineKeyboard()
          .text("📊 Full Report", "report")
          .text("📬 Outreach", "outreach")
          .row()
          .text("🔝 Top 10", "top_10");

        await ctx.reply(msg, {
          parse_mode: "MarkdownV2",
          reply_markup: kb,
        });
      } catch (err) {
        await ctx.reply(`❌ Search failed: ${(err as Error).message}`);
      }
    });

    this.bot.command("leads", async (ctx) => {
      const leads = this.agent.getLeadManager().getAllLeads();

      if (leads.length === 0) {
        await ctx.reply("No leads yet. Run /search first.");
        return;
      }

      let msg = `📋 *All Leads (${leads.length})*\n\n`;
      for (const lead of leads.slice(0, 20)) {
        const addr = lead.property.address || lead.property.id;
        const statusEmoji = this.getStatusEmoji(lead.status);
        msg += `${statusEmoji} *${lead.score}* | ${addr}\n`;
        msg += `  Status: ${lead.status}\n`;
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    });

    this.bot.command("top", async (ctx) => {
      const report = this.agent.getLeadManager().generateReport();
      const top = report.topLeads.slice(0, 5);

      if (top.length === 0) {
        await ctx.reply("No leads yet. Run /search first.");
        return;
      }

      let msg = "🏆 *Top 5 Leads*\n\n";
      for (let i = 0; i < top.length; i++) {
        const lead = top[i];
        const addr = lead.property.address || lead.property.id;
        const val = lead.valueEstimate
          ? `$${lead.valueEstimate.price.toLocaleString()}`
          : "N/A";
        const rent = lead.rentalEstimate
          ? `$${lead.rentalEstimate.rent.toLocaleString()}/mo`
          : "N/A";
        const owner = lead.ownerVerification?.name || "Unknown";

        msg += `*${i + 1}. Score: ${lead.score}* — ${addr}\n`;
        msg += `  Value: ${val} | Rent: ${rent}\n`;
        msg += `  Owner: ${owner}\n`;
        msg += `  Status: ${lead.status}\n\n`;
      }

      const kb = new InlineKeyboard()
        .text("📬 Send Offers", "outreach")
        .text("📊 Report", "report");

      await ctx.reply(msg, {
        parse_mode: "MarkdownV2",
        reply_markup: kb,
      });
    });

    this.bot.command("outreach", async (ctx) => {
      await ctx.reply("📬 Sending offers to qualified leads...");

      try {
        const sent = await this.agent.executeOutreach();

        if (sent.length === 0) {
          await ctx.reply("No leads qualified for outreach.");
          return;
        }

        let msg = `✅ *Sent ${sent.length} offers*\n\n`;
        for (const lead of sent) {
          const addr = lead.property.address || lead.property.id;
          const method = lead.outreachMethod || "email";
          msg += `📧 ${addr} (${method})\n`;
        }

        await ctx.reply(msg, { parse_mode: "MarkdownV2" });
      } catch (err) {
        await ctx.reply(`❌ Outreach failed: ${(err as Error).message}`);
      }
    });

    this.bot.command("replies", async (ctx) => {
      await ctx.reply("📬 Checking for owner replies...");

      try {
        const responded = await this.agent.checkReplies();

        if (responded.length === 0) {
          await ctx.reply("No new replies yet.");
          return;
        }

        let msg = `🎉 *${responded.length} owners responded\\!*\n\n`;
        for (const lead of responded) {
          const addr = lead.property.address || lead.property.id;
          msg += `🏠 ${addr} — *HOT LEAD*\n`;
        }

        await ctx.reply(msg, { parse_mode: "MarkdownV2" });
      } catch (err) {
        await ctx.reply(`❌ Check failed: ${(err as Error).message}`);
      }
    });

    this.bot.command("cycle", async (ctx) => {
      await ctx.reply("🔄 Running full cycle: Search → Score → Outreach...");

      try {
        await this.agent.runFullCycle();

        const report = this.agent.getLeadManager().generateReport();
        let msg = `✅ *Cycle Complete*\n\n`;
        msg += `Total leads: ${report.total}\n`;
        msg += `Average score: ${report.averageScore}\n\n`;

        for (const [status, count] of Object.entries(report.byStatus)) {
          msg += `${this.getStatusEmoji(status as LeadStatus)} ${status}: ${count}\n`;
        }

        if (report.topLeads.length > 0) {
          msg += "\n*Top leads:*\n";
          for (const lead of report.topLeads.slice(0, 3)) {
            const addr = lead.property.address || lead.property.id;
            msg += `  *${lead.score}* — ${addr}\n`;
          }
        }

        await ctx.reply(msg, { parse_mode: "MarkdownV2" });
      } catch (err) {
        await ctx.reply(`❌ Cycle failed: ${(err as Error).message}`);
      }
    });

    this.bot.command("report", async (ctx) => {
      const report = this.agent.getLeadManager().generateReport();

      let msg = `📊 *Pipeline Report*\n\n`;
      msg += `Total leads: *${report.total}*\n`;
      msg += `Avg score: *${report.averageScore}*\n\n`;
      msg += "*By status:*\n";
      for (const [status, count] of Object.entries(report.byStatus)) {
        msg += `  ${this.getStatusEmoji(status as LeadStatus)} ${status}: ${count}\n`;
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    });

    this.bot.callbackQuery("report", async (ctx) => {
      await ctx.answerCallbackQuery();
      const report = this.agent.getLeadManager().generateReport();

      let msg = `📊 *Pipeline Report*\n\n`;
      msg += `Total: *${report.total}* | Avg: *${report.averageScore}*\n\n`;
      for (const [status, count] of Object.entries(report.byStatus)) {
        msg += `${this.getStatusEmoji(status as LeadStatus)} ${status}: ${count}\n`;
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    });

    this.bot.callbackQuery("outreach", async (ctx) => {
      await ctx.answerCallbackQuery();
      const sent = await this.agent.executeOutreach();
      await ctx.reply(
        sent.length > 0
          ? `✅ Sent ${sent.length} offers`
          : "No leads qualified."
      );
    });

    this.bot.callbackQuery("top_10", async (ctx) => {
      await ctx.answerCallbackQuery();
      const leads = this.agent.getLeadManager().getAllLeads().slice(0, 10);

      let msg = "🔝 *Top 10 Leads*\n\n";
      for (let i = 0; i < leads.length; i++) {
        const addr = leads[i].property.address || leads[i].property.id;
        msg += `${i + 1}. *${leads[i].score}* — ${addr}\n`;
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    });
  }

  private getStatusEmoji(status: LeadStatus): string {
    const map: Record<string, string> = {
      [LeadStatus.DISCOVERED]: "🔍",
      [LeadStatus.ENRICHED]: "📈",
      [LeadStatus.SCORED]: "⭐",
      [LeadStatus.OUTREACH_QUEUED]: "📬",
      [LeadStatus.OUTREACH_SENT]: "✉️",
      [LeadStatus.OWNER_RESPONDED]: "🔥",
      [LeadStatus.QUALIFIED]: "✅",
      [LeadStatus.LOST]: "❌",
    };
    return map[status] || "⚪";
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
      if (err instanceof GrammyError) {
        console.error(`Telegram error: ${err.description}`);
      } else {
        throw err;
      }
    }
  }

  stop(): void {
    this.bot.stop();
    console.log("Telegram bot stopped");
  }
}
