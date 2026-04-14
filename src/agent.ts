import { LocusClient } from "./services/locus";
import { PropertySearchService } from "./services/propertySearch";
import { DueDiligenceService } from "./services/dueDiligence";
import { OutreachService } from "./services/outreach";
import { LeadManager } from "./services/leadManager";
import {
  AgentConfig,
  Lead,
  LeadStatus,
  SearchCriteria,
} from "./types";

export class RealEstateAgent {
  private config: AgentConfig;
  private locus: LocusClient;
  private propertySearch: PropertySearchService;
  private dueDiligence: DueDiligenceService;
  private outreach: OutreachService;
  private leadManager: LeadManager;
  private isRunning = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.locus = new LocusClient(config.locusApiKey, config.locusApiBase);
    this.propertySearch = new PropertySearchService(this.locus);
    this.dueDiligence = new DueDiligenceService(this.locus);
    this.outreach = new OutreachService(this.locus);
    this.leadManager = new LeadManager();
  }

  async init(): Promise<boolean> {
    console.log("Initializing Home402 Autonomous Lead Hunter...");

    const balance = await this.locus.getBalance();
    if (!balance) {
      console.error("Failed to connect to Locus. Check your API key.");
      return false;
    }

    console.log(
      `Locus wallet connected. Balance: ${balance.balance} ${balance.token}`
    );

    const inbox = await this.outreach.setupEmailInbox(
      this.config.agentmailUsername
    );
    if (!inbox) {
      console.error("Failed to set up AgentMail inbox.");
      return false;
    }

    console.log("Agent initialized successfully.\n");
    return true;
  }

  async searchAndScore(
    criteria?: Partial<SearchCriteria>
  ): Promise<Lead[]> {
    const searchCriteria: SearchCriteria = {
      city: criteria?.city || this.config.searchCity,
      state: criteria?.state || this.config.searchState,
      propertyType:
        criteria?.propertyType || this.config.searchPropertyType,
      radius: criteria?.radius || this.config.searchRadius,
      limit: criteria?.limit || 20,
    };

    console.log("=== PHASE 1: PROPERTY SEARCH ===");
    const results =
      await this.propertySearch.findUndervaluedProperties(searchCriteria);
    console.log(
      `Found ${results.length} potentially undervalued properties\n`
    );

    const newLeads: Lead[] = [];

    for (const result of results) {
      const lead = this.leadManager.createLead(result.property);
      this.leadManager.enrichLead(lead.id, {
        valueEstimate: result.valueEstimate,
        rentalEstimate: result.rentalEstimate,
      });
      newLeads.push(lead);
    }

    console.log("=== PHASE 2: DUE DILIGENCE ===");
    for (const lead of newLeads) {
      const diligence = await this.dueDiligence.runFullDiligence(
        lead.property
      );

      this.leadManager.addDiligence(lead.id, {
        ownerVerification: diligence.ownerVerification ?? undefined,
        techProfile: diligence.techProfile ?? undefined,
      });
    }

    console.log("=== PHASE 3: SCORING ===");
    for (const lead of newLeads) {
      this.leadManager.scoreLead(lead.id);
    }

    return newLeads;
  }

  async executeOutreach(threshold?: number): Promise<Lead[]> {
    const scoreThreshold =
      threshold || this.config.leadScoreThreshold;
    const leads = this.leadManager.getLeadsAboveThreshold(
      scoreThreshold
    );
    const sent: Lead[] = [];

    console.log(
      `=== PHASE 4: OUTREACH (${leads.length} leads above ${scoreThreshold}) ===`
    );

    for (const lead of leads) {
      if (lead.status === LeadStatus.OUTREACH_SENT) continue;

      const result = await this.outreach.executeOutreach(lead);

      if (result.success) {
        this.leadManager.markOutreachSent(lead.id, result.method);
        sent.push(this.leadManager.getLead(lead.id)!);
      }
    }

    return sent;
  }

  async checkReplies(): Promise<Lead[]> {
    const replies = await this.outreach.checkForReplies();
    const responded: Lead[] = [];

    if (replies.length > 0) {
      console.log(`=== GOT ${replies.length} OWNER REPLIES ===`);

      const allLeads = this.leadManager.getAllLeads();
      for (const reply of replies) {
        for (const lead of allLeads) {
          if (lead.status === LeadStatus.OUTREACH_SENT) {
            this.leadManager.markOwnerResponded(lead.id);
            responded.push(this.leadManager.getLead(lead.id)!);
            break;
          }
        }
      }
    }

    return responded;
  }

  async runFullCycle(): Promise<void> {
    console.log("\nStarting full lead gen cycle...\n");

    await this.searchAndScore();
    await this.executeOutreach();

    const report = this.leadManager.generateReport();
    console.log("\n=== LEAD REPORT ===");
    console.log(`Total leads: ${report.total}`);
    console.log(`Average score: ${report.averageScore}`);
    console.log("By status:", JSON.stringify(report.byStatus));

    if (report.topLeads.length > 0) {
      console.log("\nTop leads:");
      for (const lead of report.topLeads.slice(0, 5)) {
        const addr = lead.property.address || lead.property.id;
        console.log(
          `  [${lead.score}] ${addr} - ${lead.status}`
        );
      }
    }
  }

  getLocus(): LocusClient {
    return this.locus;
  }

  getLeadManager(): LeadManager {
    return this.leadManager;
  }

  getPropertySearch(): PropertySearchService {
    return this.propertySearch;
  }

  getDueDiligence(): DueDiligenceService {
    return this.dueDiligence;
  }

  getOutreach(): OutreachService {
    return this.outreach;
  }

  getConfig(): AgentConfig {
    return this.config;
  }
}
