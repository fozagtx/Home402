import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutreachService } from "../services/outreach";
import { LocusClient } from "../services/locus";
import { Lead, LeadStatus, OutreachMethod } from "../types";

const makeLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "lead_test1",
  property: {
    id: "prop1",
    address: "100 Brickell Ave, Miami, FL",
    city: "Miami",
    state: "FL",
    zipCode: "33131",
    latitude: 25.765,
    longitude: -80.189,
    propertyType: "Multi-Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2400,
    lotSize: 5000,
    yearBuilt: 2005,
    ownerName: "John Smith",
  },
  score: 85,
  status: LeadStatus.SCORED,
  notes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ownerVerification: {
    name: "John Smith",
    isValid: true,
    emails: ["john@example.com"],
  },
  ...overrides,
});

describe("OutreachService", () => {
  let service: OutreachService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const client = new LocusClient("test_key", "https://api.paywithlocus.com/api");
    service = new OutreachService(client);
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("should create an AgentMail inbox", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          inboxId: "inbox_abc123",
          email: "home402@agentmail.to",
        },
      }),
    });

    const inbox = await service.setupEmailInbox("home402");
    expect(inbox).not.toBeNull();
    expect(inbox!.email).toBe("home402@agentmail.to");
    expect(inbox!.inboxId).toBe("inbox_abc123");
  });

  it("should return null on failed inbox creation", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: "Unauthorized" }),
    });

    const inbox = await service.setupEmailInbox("test");
    expect(inbox).toBeNull();
  });

  it("should send an offer email", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { inboxId: "inbox_abc", email: "test@agentmail.to" },
      }),
    });
    await service.setupEmailInbox("test");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    const result = await service.sendOfferEmail(
      "owner@example.com",
      makeLead()
    );
    expect(result).toBe(true);
  });

  it("should fail to send email without inbox setup", async () => {
    const result = await service.sendOfferEmail(
      "owner@example.com",
      makeLead()
    );
    expect(result).toBe(false);
  });

  it("should check for replies", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { inboxId: "inbox_abc", email: "test@agentmail.to" },
      }),
    });
    await service.setupEmailInbox("test");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          messages: [
            {
              id: "msg_1",
              from: "owner@example.com",
              subject: "Re: Interest in Property",
              snippet: "I'm interested in discussing...",
              receivedAt: "2026-04-14T12:00:00Z",
            },
          ],
        },
      }),
    });

    const replies = await service.checkForReplies();
    expect(replies.length).toBe(1);
    expect(replies[0].messageId).toBe("msg_1");
    expect(replies[0].from).toBe("owner@example.com");
  });

  it("should determine outreach method as email when owner has emails", async () => {
    const method = await service.determineOutreachMethod({
      name: "John",
      isValid: true,
      emails: ["john@test.com"],
    });
    expect(method).toBe(OutreachMethod.EMAIL);
  });

  it("should default to email when no owner info", async () => {
    const method = await service.determineOutreachMethod(null);
    expect(method).toBe(OutreachMethod.EMAIL);
  });

  it("should fail outreach when no verified email", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { inboxId: "inbox_abc", email: "test@agentmail.to" },
      }),
    });
    await service.setupEmailInbox("test");

    const leadNoEmail = makeLead();
    delete leadNoEmail.ownerVerification;

    const result = await service.executeOutreach(leadNoEmail);
    expect(result.success).toBe(false);
  });

  it("should execute outreach end to end with verified email", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { inboxId: "inbox_abc", email: "test@agentmail.to" },
      }),
    });
    await service.setupEmailInbox("test");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    const result = await service.executeOutreach(makeLead());
    expect(result.success).toBe(true);
    expect(result.method).toBe(OutreachMethod.EMAIL);
    expect(result.sentAt).toBeDefined();
  });
});
