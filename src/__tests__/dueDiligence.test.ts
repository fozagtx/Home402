import { describe, it, expect, vi, beforeEach } from "vitest";
import { DueDiligenceService } from "../services/dueDiligence";
import { LocusClient } from "../services/locus";
import { PropertyRecord } from "../types";

const makeProperty = (overrides: Partial<PropertyRecord> = {}): PropertyRecord => ({
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
  ...overrides,
});

describe("DueDiligenceService", () => {
  let service: DueDiligenceService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const client = new LocusClient("test_key", "https://api.paywithlocus.com/api");
    service = new DueDiligenceService(client);
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("should verify an owner via Whitepages Pro", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          isValid: true,
          phoneNumbers: ["305-555-1234"],
          emails: ["john@example.com"],
          riskScore: 15,
        },
      }),
    });

    const result = await service.verifyOwner(makeProperty());
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(true);
    expect(result!.emails).toContain("john@example.com");
  });

  it("should return invalid owner when no owner name", async () => {
    const result = await service.verifyOwner(makeProperty({ ownerName: undefined }));
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.name).toBe("Unknown");
  });

  it("should profile a business tech stack via BuiltWith", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          Paths: [
            {
              technologies: [
                { Name: "React", Categories: "JavaScript Framework" },
                { Name: "AWS", Categories: "Hosting" },
              ],
            },
          ],
          Meta: { spend: 2500 },
        },
      }),
    });

    const profile = await service.profileBusinessTech("example.com");
    expect(profile).not.toBeNull();
    expect(profile!.technologies).toContain("React");
    expect(profile!.technologies).toContain("AWS");
    expect(profile!.spendEstimate).toBe(2500);
  });

  it("should return null for failed BuiltWith lookup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: "Not found" }),
    });

    const profile = await service.profileBusinessTech("nonexistent.xyz");
    expect(profile).toBeNull();
  });

  it("should run full diligence and return a score", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            isValid: true,
            emails: ["owner@example.com"],
            riskScore: 20,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            Paths: [{ technologies: [{ Name: "React", Categories: "JS" }] }],
            Meta: { spend: 3000 },
          },
        }),
      });

    const result = await service.runFullDiligence(makeProperty());

    expect(result.ownerVerification).not.toBeNull();
    expect(result.ownerVerification!.isValid).toBe(true);
    expect(result.techProfile).not.toBeNull();
    expect(result.diligenceScore).toBeGreaterThan(0);
  });

  it("should handle diligence gracefully with partial failures", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: "fail" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: "fail" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: "fail" }),
      });

    const result = await service.runFullDiligence(makeProperty());
    expect(result.diligenceScore).toBeGreaterThanOrEqual(0);
  });
});
