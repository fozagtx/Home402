import { LocusClient } from "./services/locus";
import { LLMService } from "./services/ai";
import { PropertySearchService } from "./services/propertySearch";
import { DueDiligenceService } from "./services/dueDiligence";
import { OutreachService } from "./services/outreach";
import { LeadManager } from "./services/leadManager";
import { MemoryService } from "./services/memory";
import {
  AgentConfig,
  Lead,
  LeadStatus,
  SearchCriteria,
} from "./types";

export class RealEstateAgent {
  private config: AgentConfig;
  private locus: LocusClient;
  private llm: LLMService;
  private propertySearch: PropertySearchService;
  private dueDiligence: DueDiligenceService;
  private outreach: OutreachService;
  private leadManager: LeadManager;
  private memory: MemoryService;

  constructor(config: AgentConfig, memoryApiKey?: string) {
    this.config = config;
    this.locus = new LocusClient(config.locusApiKey, config.locusApiBase);
    this.llm = new LLMService(
      config.openrouterApiKey,
      config.openrouterModel
    );
    this.propertySearch = new PropertySearchService(this.locus);
    this.dueDiligence = new DueDiligenceService(this.locus);
    this.outreach = new OutreachService(this.locus);
    this.leadManager = new LeadManager();
    this.memory = new MemoryService(memoryApiKey);
  }

  async init(): Promise<boolean> {
    console.log("Initializing Home402 Autonomous Lead Hunter...");

    const balance = await this.locus.getBalance();
    if (!balance) {
      console.error("Failed to connect to Locus. Check your API key.");
      return false;
    }
    console.log(
      `Locus wallet: ${balance.balance} ${balance.token}`
    );

    const inbox = await this.outreach.setupEmailInbox(
      this.config.agentmailUsername
    );
    if (!inbox) {
      console.error("Failed to set up AgentMail inbox.");
      return false;
    }

    console.log("Agent ready.\n");
    return true;
  }

  private summarizeProperty(lead: Lead): string {
    const p = lead.property;
    const parts = [
      `Address: ${p.address || "Unknown"}`,
      `Type: ${p.propertyType}`,
      `City: ${p.city}, ${p.state} ${p.zipCode}`,
      `Beds/Baths: ${p.bedrooms}/${p.bathrooms}`,
      `SqFt: ${p.squareFootage}`,
      `Year Built: ${p.yearBuilt}`,
    ];
    if (p.lastSalePrice) parts.push(`Last Sale: $${p.lastSalePrice.toLocaleString()}`);
    if (p.assessedValue) parts.push(`Assessed: $${p.assessedValue.toLocaleString()}`);
    if (lead.valueEstimate) {
      parts.push(`Market Value: $${lead.valueEstimate.price.toLocaleString()} (confidence: ${lead.valueEstimate.confidence})`);
    }
    if (lead.rentalEstimate) {
      parts.push(`Est. Rent: $${lead.rentalEstimate.rent.toLocaleString()}/mo`);
    }
    if (lead.ownerVerification) {
      parts.push(`Owner: ${lead.ownerVerification.name} (verified: ${lead.ownerVerification.isValid})`);
    }
    if (lead.techProfile) {
      parts.push(`Business Tech: ${lead.techProfile.technologies.slice(0, 5).join(", ")}`);
      if (lead.techProfile.spendEstimate) {
        parts.push(`Tech Spend: ~$${lead.techProfile.spendEstimate.toLocaleString()}`);
      }
    }
    return parts.join("\n");
  }

  async thinkAndScore(lead: Lead): Promise<Lead | null> {
    const summary = this.summarizeProperty(lead);

    console.log(`Agent analyzing: ${lead.property.address || lead.property.id}`);

    const analysis = await this.llm.analyzeProperty(summary);
    if (!analysis) {
      console.error("LLM analysis failed — skipping lead");
      return null;
    }

    const updated = this.leadManager.getLead(lead.id);
    if (!updated) return null;

    updated.score = analysis.score;
    updated.status = analysis.shouldPursue
      ? LeadStatus.SCORED
      : LeadStatus.LOST;
    updated.notes.push(
      `Agent scored ${analysis.score}/100: ${analysis.reasoning}`
    );
    updated.notes.push(`Strategy: ${analysis.strategy}`);
    updated.updatedAt = new Date().toISOString();

    console.log(
      `  → Score: ${analysis.score} | Pursue: ${analysis.shouldPursue} | ${analysis.reasoning.substring(0, 80)}...`
    );

    return updated;
  }

  async thinkAndReachOut(lead: Lead): Promise<{
    success: boolean;
    subject?: string;
    reasoning?: string;
  }> {
    if (!lead.ownerVerification?.emails?.length) {
      console.log(`  → Skipping ${lead.id}: no verified email`);
      return { success: false, reasoning: "No verified owner email" };
    }

    const summary = this.summarizeProperty(lead);
    const ownerInfo = [
      `Name: ${lead.ownerVerification.name}`,
      `Verified: ${lead.ownerVerification.isValid}`,
      `Email: ${lead.ownerVerification.emails[0]}`,
    ].join("\n");

    const strategy = lead.notes.find((n) => n.startsWith("Strategy: "))?.replace("Strategy: ", "") || "Direct acquisition interest";

    console.log(`Agent writing outreach for: ${lead.property.address || lead.property.id}`);

    const email = await this.llm.generateOutreachEmail(
      summary,
      ownerInfo,
      strategy
    );

    if (!email) {
      return { success: false, reasoning: "LLM failed to generate email" };
    }

    const sent = await this.outreach.sendEmail(
      lead.ownerVerification.emails[0],
      email.subject,
      email.body
    );

    if (sent) {
      this.leadManager.markOutreachSent(lead.id, "email");
      const updated = this.leadManager.getLead(lead.id);
      if (updated) {
        updated.notes.push(`Email subject: ${email.subject}`);
        updated.updatedAt = new Date().toISOString();
      }
      console.log(`  → Sent "${email.subject}" to ${lead.ownerVerification.emails[0]}`);
      return { success: true, subject: email.subject };
    }

    return { success: false, reasoning: "Failed to send email" };
  }

  async thinkAboutReplies(): Promise<
    Array<{
      lead: Lead;
      analysis: {
        sentiment: string;
        interest: string;
        nextStep: string;
        shouldEscalate: boolean;
        suggestedResponse: string;
      };
    }>
  > {
    const replies = await this.outreach.checkForReplies();
    if (replies.length === 0) return [];

    const results: Array<{
      lead: Lead;
      analysis: any;
    }> = [];

    for (const reply of replies) {
      const allLeads = this.leadManager.getLeadsByStatus(LeadStatus.OUTREACH_SENT);
      const lead = allLeads[0];
      if (!lead) continue;

      console.log(`Agent analyzing reply from: ${reply.from}`);

      const propertySummary = this.summarizeProperty(lead);
      const emailSubject = lead.notes.find((n) => n.startsWith("Email subject: ")) || "our acquisition inquiry";

      const analysis = await this.llm.analyzeReply(
        emailSubject,
        `From: ${reply.from}\nSubject: ${reply.subject}\n\n${reply.snippet}`,
        propertySummary
      );

      if (!analysis) continue;

      this.leadManager.markOwnerResponded(lead.id);
      const updated = this.leadManager.getLead(lead.id);

      if (updated) {
        updated.notes.push(
          `Owner reply [${analysis.sentiment}/${analysis.interest}]: ${reply.snippet.substring(0, 100)}`
        );
        updated.notes.push(`Agent says: ${analysis.nextStep}`);

        if (analysis.shouldEscalate) {
          updated.notes.push("⚠️ ESCALATE TO HUMAN");
          updated.status = LeadStatus.QUALIFIED;
        }

        updated.updatedAt = new Date().toISOString();
      }

      if (analysis.suggestedResponse && this.outreach) {
        await this.outreach.replyToMessage(reply.messageId, analysis.suggestedResponse);
        updated?.notes.push(`Auto-replied to owner`);
      }

      results.push({ lead: updated!, analysis });
    }

    return results;
  }

  async searchAndScore(criteria?: Partial<SearchCriteria>): Promise<Lead[]> {
    const searchCriteria: SearchCriteria = {
      city: criteria?.city || this.config.searchCity,
      state: criteria?.state || this.config.searchState,
      propertyType: criteria?.propertyType || this.config.searchPropertyType,
      radius: criteria?.radius || this.config.searchRadius,
      limit: criteria?.limit || 20,
    };

    console.log("=== AGENT: Searching properties ===");
    const results = await this.propertySearch.findUndervaluedProperties(searchCriteria);
    console.log(`Found ${results.length} properties\n`);

    const newLeads: Lead[] = [];

    for (const result of results) {
      const lead = this.leadManager.createLead(result.property);
      this.leadManager.enrichLead(lead.id, {
        valueEstimate: result.valueEstimate,
        rentalEstimate: result.rentalEstimate,
      });

      const diligence = await this.dueDiligence.runFullDiligence(result.property);
      this.leadManager.addDiligence(lead.id, {
        ownerVerification: diligence.ownerVerification ?? undefined,
        techProfile: diligence.techProfile ?? undefined,
      });

      const freshLead = this.leadManager.getLead(lead.id);
      if (!freshLead) continue;

      const scored = await this.thinkAndScore(freshLead);
      if (scored) newLeads.push(scored);
    }

    return newLeads;
  }

  async executeOutreach(threshold?: number): Promise<Lead[]> {
    const scoreThreshold = threshold || this.config.leadScoreThreshold;
    const leads = this.leadManager
      .getAllLeads()
      .filter((l) => l.score >= scoreThreshold && l.status === LeadStatus.SCORED);

    console.log(`\n=== AGENT: Reaching out to ${leads.length} scored leads ===`);

    const sent: Lead[] = [];
    for (const lead of leads) {
      const result = await this.thinkAndReachOut(lead);
      if (result.success) {
        sent.push(this.leadManager.getLead(lead.id)!);
      }
    }
    return sent;
  }

  async checkReplies(): Promise<Lead[]> {
    const analyses = await this.thinkAboutReplies();
    return analyses.map((a) => a.lead);
  }

  async runFullCycle(): Promise<void> {
    console.log("\n🧠 Agent starting full autonomous cycle...\n");

    await this.searchAndScore();
    await this.executeOutreach();
    const replies = await this.thinkAboutReplies();

    const report = this.leadManager.generateReport();
    console.log("\n=== AGENT REPORT ===");
    console.log(`Total leads: ${report.total}`);
    console.log(`Average score: ${report.averageScore}`);
    console.log("By status:", JSON.stringify(report.byStatus));

    if (replies.length > 0) {
      console.log(`\n🔥 ${replies.length} owners responded!`);
      for (const r of replies) {
        console.log(
          `  ${r.lead.property.address}: ${r.analysis.sentiment}/${r.analysis.interest} — ${r.analysis.nextStep}`
        );
      }
    }

    if (report.topLeads.length > 0) {
      console.log("\nTop leads:");
      for (const lead of report.topLeads.slice(0, 5)) {
        const addr = lead.property.address || lead.property.id;
        console.log(`  [${lead.score}] ${addr} - ${lead.status}`);
      }
    }
  }

  getLocus(): LocusClient { return this.locus; }
  getLLM(): LLMService { return this.llm; }
  getLeadManager(): LeadManager { return this.leadManager; }
  getPropertySearch(): PropertySearchService { return this.propertySearch; }
  getDueDiligence(): DueDiligenceService { return this.dueDiligence; }
  getOutreach(): OutreachService { return this.outreach; }
  getConfig(): AgentConfig { return this.config; }
  getMemory(): MemoryService { return this.memory; }
}
