import { describe, it, expect, vi, beforeEach } from "vitest";
import { PropertySearchService } from "../services/propertySearch";
import { LocusClient } from "../services/locus";

describe("PropertySearchService", () => {
  let service: PropertySearchService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const client = new LocusClient("test_key", "https://api.paywithlocus.com/api");
    service = new PropertySearchService(client);
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("should search properties and return results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
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
            lastSalePrice: 350000,
          },
        ],
      }),
    });

    const results = await service.searchProperties({
      city: "Miami",
      state: "FL",
      propertyType: "Multi-Family",
    });

    expect(results.length).toBe(1);
    expect(results[0].city).toBe("Miami");
    expect(results[0].propertyType).toBe("Multi-Family");
  });

  it("should return empty array on failed search", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: "Bad request" }),
    });

    const results = await service.searchProperties({
      city: "Nowhere",
      state: "XX",
    });
    expect(results).toEqual([]);
  });

  it("should get a value estimate", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          price: 450000,
          priceLow: 400000,
          priceHigh: 500000,
          confidence: "High",
          comparables: [],
        },
      }),
    });

    const estimate = await service.getValueEstimate("100 Brickell Ave, Miami, FL");
    expect(estimate).not.toBeNull();
    expect(estimate!.price).toBe(450000);
    expect(estimate!.confidence).toBe("High");
  });

  it("should get a rental estimate", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rent: 3500,
          rentLow: 3000,
          rentHigh: 4000,
          confidence: "High",
          comparables: [],
        },
      }),
    });

    const estimate = await service.getRentalEstimate("100 Brickell Ave, Miami, FL");
    expect(estimate).not.toBeNull();
    expect(estimate!.rent).toBe(3500);
  });

  it("should get market stats for a zip code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          zipCode: "33131",
          dataType: "All",
          saleMedian: 420000,
          rentalMedian: 3200,
          daysOnMarket: 25,
        },
      }),
    });

    const stats = await service.getMarketStats("33131");
    expect(stats).not.toBeNull();
    expect(stats!.zipCode).toBe("33131");
    expect(stats!.saleMedian).toBe(420000);
  });

  it("should geocode an address", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          features: [
            {
              center: [-80.189, 25.765],
              place_name: "100 Brickell Ave, Miami, FL 33131",
            },
          ],
        },
      }),
    });

    const geo = await service.geocodeAddress("100 Brickell Ave, Miami, FL");
    expect(geo).not.toBeNull();
    expect(geo!.latitude).toBe(25.765);
    expect(geo!.longitude).toBe(-80.189);
  });

  it("should return null for failed geocode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { features: [] },
      }),
    });

    const geo = await service.geocodeAddress("nonexistent address xyz");
    expect(geo).toBeNull();
  });
});
