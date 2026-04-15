import {
  Lead,
  LeadStatus,
  PropertyRecord,
  PropertyValue,
  RentalEstimate,
  MarketStats,
  OwnerVerification,
  TechProfile,
} from "../types";

export class LeadManager {
  private leads: Map<string, Lead> = new Map();

  createLead(property: PropertyRecord): Lead {
    const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const lead: Lead = {
      id,
      property,
      score: 0,
      status: LeadStatus.DISCOVERED,
      notes: [`Discovered: ${new Date().toISOString()}`],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.leads.set(id, lead);
    console.log(
      `Created lead ${id} for ${property.address || property.id}`
    );
    return lead;
  }

  enrichLead(
    leadId: string,
    data: {
      valueEstimate?: PropertyValue;
      rentalEstimate?: RentalEstimate;
      marketStats?: MarketStats;
    }
  ): Lead | null {
    const lead = this.leads.get(leadId);
    if (!lead) return null;

    if (data.valueEstimate) lead.valueEstimate = data.valueEstimate;
    if (data.rentalEstimate) lead.rentalEstimate = data.rentalEstimate;
    if (data.marketStats) lead.marketStats = data.marketStats;

    lead.status = LeadStatus.ENRICHED;
    lead.notes.push(`Enriched: ${new Date().toISOString()}`);
    lead.updatedAt = new Date().toISOString();

    return lead;
  }

  addDiligence(
    leadId: string,
    data: {
      ownerVerification?: OwnerVerification;
      techProfile?: TechProfile;
    }
  ): Lead | null {
    const lead = this.leads.get(leadId);
    if (!lead) return null;

    if (data.ownerVerification)
      lead.ownerVerification = data.ownerVerification;
    if (data.techProfile) lead.techProfile = data.techProfile;

    lead.notes.push(`Diligence complete: ${new Date().toISOString()}`);
    lead.updatedAt = new Date().toISOString();

    return lead;
  }

  scoreLead(leadId: string): Lead | null {
    const lead = this.leads.get(leadId);
    if (!lead) return null;

    let score = 30;

    if (lead.valueEstimate) {
      const lastSale = lead.property.lastSalePrice || 0;
      const marketValue = lead.valueEstimate.price;

      if (lastSale > 0 && marketValue > lastSale) {
        const discount = (marketValue - lastSale) / marketValue;
        score += Math.min(discount * 200, 20);
      }

      if (lead.valueEstimate.confidence === "High") score += 10;
      else if (lead.valueEstimate.confidence === "Medium") score += 5;
    }

    if (lead.rentalEstimate && lead.valueEstimate) {
      const annualRent = lead.rentalEstimate.rent * 12;
      const capRate = annualRent / lead.valueEstimate.price;
      score += Math.min(capRate * 150, 15);
    }

    if (lead.property.lastSalePrice && lead.property.lastSalePrice > 0) {
      score += 5;
    }

    if (lead.property.squareFootage && lead.property.squareFootage > 1000) {
      score += 5;
    }

    if (lead.property.bedrooms && lead.property.bedrooms >= 3) {
      score += 5;
    }

    if (lead.ownerVerification) {
      if (lead.ownerVerification.isValid) score += 10;
      if (lead.ownerVerification.emails && lead.ownerVerification.emails.length > 0)
        score += 5;
    }

    lead.score = Math.min(Math.round(score), 100);
    lead.status = LeadStatus.SCORED;
    lead.notes.push(
      `Scored: ${lead.score}/100 - ${new Date().toISOString()}`
    );
    lead.updatedAt = new Date().toISOString();

    return lead;
  }

  markOutreachSent(
    leadId: string,
    method: string
  ): Lead | null {
    const lead = this.leads.get(leadId);
    if (!lead) return null;

    lead.status = LeadStatus.OUTREACH_SENT;
    lead.outreachMethod = method as any;
    lead.outreachSentAt = new Date().toISOString();
    lead.notes.push(
      `Outreach sent via ${method}: ${new Date().toISOString()}`
    );
    lead.updatedAt = new Date().toISOString();

    return lead;
  }

  markOwnerResponded(leadId: string): Lead | null {
    const lead = this.leads.get(leadId);
    if (!lead) return null;

    lead.status = LeadStatus.OWNER_RESPONDED;
    lead.ownerRespondedAt = new Date().toISOString();
    lead.notes.push(`Owner responded: ${new Date().toISOString()}`);
    lead.updatedAt = new Date().toISOString();

    return lead;
  }

  getLeadsAboveThreshold(threshold: number): Lead[] {
    return Array.from(this.leads.values())
      .filter((lead) => lead.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  getLeadsByStatus(status: LeadStatus): Lead[] {
    return Array.from(this.leads.values()).filter(
      (lead) => lead.status === status
    );
  }

  getLead(leadId: string): Lead | null {
    return this.leads.get(leadId) || null;
  }

  getAllLeads(): Lead[] {
    return Array.from(this.leads.values()).sort(
      (a, b) => b.score - a.score
    );
  }

  generateReport(): {
    total: number;
    byStatus: Record<string, number>;
    averageScore: number;
    topLeads: Lead[];
  } {
    const leads = this.getAllLeads();
    const byStatus: Record<string, number> = {};

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
    }

    const averageScore =
      leads.length > 0
        ? Math.round(
            leads.reduce((sum, l) => sum + l.score, 0) / leads.length
          )
        : 0;

    return {
      total: leads.length,
      byStatus,
      averageScore,
      topLeads: leads.slice(0, 10),
    };
  }
}
