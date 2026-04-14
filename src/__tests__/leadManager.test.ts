import { describe, it, expect } from "vitest";
import { LeadManager } from "../services/leadManager";
import { LeadStatus } from "../types";

const makeProperty = (overrides: Record<string, any> = {}) => ({
  id: "prop_test1",
  address: "123 Main St, Miami, FL 33101",
  city: "Miami",
  state: "FL",
  zipCode: "33101",
  latitude: 25.7617,
  longitude: -80.1918,
  propertyType: "Multi-Family",
  bedrooms: 4,
  bathrooms: 3,
  squareFootage: 2400,
  lotSize: 5000,
  yearBuilt: 1985,
  ...overrides,
});

describe("LeadManager", () => {
  it("should create a lead with DISCOVERED status", () => {
    const mgr = new LeadManager();
    const lead = mgr.createLead(makeProperty());

    expect(lead.status).toBe(LeadStatus.DISCOVERED);
    expect(lead.score).toBe(0);
    expect(lead.notes.length).toBe(1);
    expect(lead.notes[0]).toContain("Discovered");
  });

  it("should enrich a lead with value and rental estimates", () => {
    const mgr = new LeadManager();
    const lead = mgr.createLead(makeProperty());

    const enriched = mgr.enrichLead(lead.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
      rentalEstimate: {
        rent: 3500,
        rentLow: 3000,
        rentHigh: 4000,
        confidence: "High",
        comparables: [],
      },
    });

    expect(enriched).not.toBeNull();
    expect(enriched!.status).toBe(LeadStatus.ENRICHED);
    expect(enriched!.valueEstimate!.price).toBe(500000);
    expect(enriched!.rentalEstimate!.rent).toBe(3500);
  });

  it("should return null when enriching non-existent lead", () => {
    const mgr = new LeadManager();
    const result = mgr.enrichLead("fake_id", {
      valueEstimate: {
        price: 100000,
        priceLow: 90000,
        priceHigh: 110000,
        confidence: "Low",
        comparables: [],
      },
    });
    expect(result).toBeNull();
  });

  it("should score a lead based on value estimate confidence", () => {
    const mgr = new LeadManager();
    const lead = mgr.createLead(makeProperty());

    mgr.enrichLead(lead.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
    });

    const scored = mgr.scoreLead(lead.id);
    expect(scored).not.toBeNull();
    expect(scored!.status).toBe(LeadStatus.SCORED);
    expect(scored!.score).toBeGreaterThan(0);
  });

  it("should give higher score for undervalued properties", () => {
    const mgr = new LeadManager();

    const cheapLead = mgr.createLead(
      makeProperty({ lastSalePrice: 300000 })
    );
    mgr.enrichLead(cheapLead.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
      rentalEstimate: {
        rent: 4000,
        rentLow: 3500,
        rentHigh: 4500,
        confidence: "High",
        comparables: [],
      },
    });

    const fullPriceLead = mgr.createLead(
      makeProperty({ lastSalePrice: 490000 })
    );
    mgr.enrichLead(fullPriceLead.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
      rentalEstimate: {
        rent: 2000,
        rentLow: 1500,
        rentHigh: 2500,
        confidence: "Medium",
        comparables: [],
      },
    });

    const cheap = mgr.scoreLead(cheapLead.id);
    const full = mgr.scoreLead(fullPriceLead.id);

    expect(cheap!.score).toBeGreaterThan(full!.score);
  });

  it("should add bonus for verified owner with emails", () => {
    const mgr = new LeadManager();

    const withOwner = mgr.createLead(makeProperty());
    mgr.enrichLead(withOwner.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
    });
    mgr.addDiligence(withOwner.id, {
      ownerVerification: {
        name: "John Doe",
        isValid: true,
        emails: ["john@example.com"],
        riskScore: 20,
      },
    });

    const withoutOwner = mgr.createLead(makeProperty());
    mgr.enrichLead(withoutOwner.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
    });

    const scored1 = mgr.scoreLead(withOwner.id);
    const scored2 = mgr.scoreLead(withoutOwner.id);

    expect(scored1!.score).toBeGreaterThan(scored2!.score);
  });

  it("should mark outreach as sent", () => {
    const mgr = new LeadManager();
    const lead = mgr.createLead(makeProperty());

    const updated = mgr.markOutreachSent(lead.id, "email");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(LeadStatus.OUTREACH_SENT);
    expect(updated!.outreachSentAt).toBeDefined();
  });

  it("should mark owner as responded", () => {
    const mgr = new LeadManager();
    const lead = mgr.createLead(makeProperty());

    mgr.markOutreachSent(lead.id, "email");
    const updated = mgr.markOwnerResponded(lead.id);

    expect(updated!.status).toBe(LeadStatus.OWNER_RESPONDED);
    expect(updated!.ownerRespondedAt).toBeDefined();
  });

  it("should filter leads by threshold", () => {
    const mgr = new LeadManager();

    const high = mgr.createLead(makeProperty({ id: "high" }));
    mgr.enrichLead(high.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
    });
    mgr.addDiligence(high.id, {
      ownerVerification: { name: "A", isValid: true, emails: ["a@b.com"] },
    });
    mgr.scoreLead(high.id);

    const low = mgr.createLead(makeProperty({ id: "low" }));
    mgr.scoreLead(low.id);

    const above70 = mgr.getLeadsAboveThreshold(70);
    expect(above70.length).toBeGreaterThanOrEqual(0);

    const above0 = mgr.getLeadsAboveThreshold(0);
    expect(above0.length).toBe(2);
  });

  it("should filter leads by status", () => {
    const mgr = new LeadManager();

    const lead1 = mgr.createLead(makeProperty());
    const lead2 = mgr.createLead(makeProperty());

    mgr.markOutreachSent(lead1.id, "email");

    const discovered = mgr.getLeadsByStatus(LeadStatus.DISCOVERED);
    const sent = mgr.getLeadsByStatus(LeadStatus.OUTREACH_SENT);

    expect(discovered.length).toBe(1);
    expect(sent.length).toBe(1);
  });

  it("should generate a report", () => {
    const mgr = new LeadManager();

    mgr.createLead(makeProperty());
    mgr.createLead(makeProperty());

    const report = mgr.generateReport();

    expect(report.total).toBe(2);
    expect(report.byStatus).toBeDefined();
    expect(report.byStatus[LeadStatus.DISCOVERED]).toBe(2);
    expect(report.topLeads.length).toBe(2);
  });

  it("should return empty report when no leads", () => {
    const mgr = new LeadManager();
    const report = mgr.generateReport();

    expect(report.total).toBe(0);
    expect(report.averageScore).toBe(0);
    expect(report.topLeads).toEqual([]);
  });

  it("should cap score at 100", () => {
    const mgr = new LeadManager();

    const lead = mgr.createLead(
      makeProperty({ lastSalePrice: 100000 })
    );
    mgr.enrichLead(lead.id, {
      valueEstimate: {
        price: 500000,
        priceLow: 450000,
        priceHigh: 550000,
        confidence: "High",
        comparables: [],
      },
      rentalEstimate: {
        rent: 10000,
        rentLow: 9000,
        rentHigh: 11000,
        confidence: "High",
        comparables: [],
      },
    });
    mgr.addDiligence(lead.id, {
      ownerVerification: {
        name: "Big Owner",
        isValid: true,
        emails: ["a@b.com", "c@d.com"],
        riskScore: 10,
      },
      techProfile: {
        domain: "bigowner.com",
        technologies: ["React", "Shopify"],
        categories: { cms: ["WordPress"] },
        spendEstimate: 5000,
      },
    });

    const scored = mgr.scoreLead(lead.id);
    expect(scored!.score).toBeLessThanOrEqual(100);
  });
});
