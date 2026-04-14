import { LocusClient } from "./locus";
import {
  PropertyRecord,
  PropertyValue,
  RentalEstimate,
  MarketStats,
  GeoCoordinate,
  SearchCriteria,
} from "../types";

export class PropertySearchService {
  private client: LocusClient;

  constructor(client: LocusClient) {
    this.client = client;
  }

  async searchProperties(
    criteria: SearchCriteria
  ): Promise<PropertyRecord[]> {
    const params: Record<string, unknown> = {
      city: criteria.city,
      state: criteria.state,
      limit: criteria.limit || 50,
    };

    if (criteria.propertyType) params.propertyType = criteria.propertyType;
    if (criteria.zipCode) params.zipCode = criteria.zipCode;
    if (criteria.radius) params.radius = criteria.radius;
    if (criteria.minBedrooms)
      params.bedrooms = String(criteria.minBedrooms);
    if (criteria.maxPrice) params.price = criteria.maxPrice;

    const res = await this.client.wrappedCall<PropertyRecord[]>(
      "rentcast",
      "properties",
      params
    );

    if (!res.success || !res.data) {
      console.error("Property search failed:", res.error);
      return [];
    }

    return Array.isArray(res.data) ? res.data : [];
  }

  async getValueEstimate(
    address: string,
    propertyType?: string,
    bedrooms?: number,
    bathrooms?: number,
    squareFootage?: number
  ): Promise<PropertyValue | null> {
    const params: Record<string, unknown> = { address };
    if (propertyType) params.propertyType = propertyType;
    if (bedrooms) params.bedrooms = bedrooms;
    if (bathrooms) params.bathrooms = bathrooms;
    if (squareFootage) params.squareFootage = squareFootage;

    const res = await this.client.wrappedCall<PropertyValue>(
      "rentcast",
      "value-estimate",
      params
    );

    if (!res.success || !res.data) {
      console.error("Value estimate failed:", res.error);
      return null;
    }

    return res.data;
  }

  async getRentalEstimate(
    address: string,
    propertyType?: string,
    bedrooms?: number,
    bathrooms?: number,
    squareFootage?: number
  ): Promise<RentalEstimate | null> {
    const params: Record<string, unknown> = { address };
    if (propertyType) params.propertyType = propertyType;
    if (bedrooms) params.bedrooms = bedrooms;
    if (bathrooms) params.bathrooms = bathrooms;
    if (squareFootage) params.squareFootage = squareFootage;

    const res = await this.client.wrappedCall<RentalEstimate>(
      "rentcast",
      "rent-estimate",
      params
    );

    if (!res.success || !res.data) {
      console.error("Rental estimate failed:", res.error);
      return null;
    }

    return res.data;
  }

  async getMarketStats(
    zipCode: string,
    dataType: "Sale" | "Rental" | "All" = "All",
    historyRange = 12
  ): Promise<MarketStats | null> {
    const res = await this.client.wrappedCall<MarketStats>(
      "rentcast",
      "markets",
      { zipCode, dataType, historyRange }
    );

    if (!res.success || !res.data) {
      console.error("Market stats failed:", res.error);
      return null;
    }

    return res.data;
  }

  async geocodeAddress(address: string): Promise<GeoCoordinate | null> {
    const res = await this.client.wrappedCall<{
      features: Array<{
        center: [number, number];
        place_name: string;
      }>;
    }>("mapbox", "geocode-forward", {
      q: address,
      limit: 1,
    });

    if (!res.success || !res.data || !res.data.features?.length) {
      console.error("Geocoding failed:", res.error);
      return null;
    }

    const feature = res.data.features[0];
    return {
      longitude: feature.center[0],
      latitude: feature.center[1],
      placeName: feature.place_name,
    };
  }

  async generatePropertyMap(
    longitude: number,
    latitude: number,
    overlays: string[] = []
  ): Promise<string | null> {
    const overlayParts = overlays.length
      ? overlays.join(",")
      : `pin-s+FF0000(${longitude},${latitude})`;

    const res = await this.client.wrappedCall<{ image: string }>(
      "mapbox",
      "static-image",
      {
        style: "mapbox/streets-v12",
        position: `${longitude},${latitude},14`,
        size: "800x600",
        overlay: overlayParts,
        retina: true,
      }
    );

    if (!res.success || !res.data) {
      console.error("Map generation failed:", res.error);
      return null;
    }

    return res.data.image || null;
  }

  async findUndervaluedProperties(
    criteria: SearchCriteria
  ): Promise<
    Array<{
      property: PropertyRecord;
      valueEstimate: PropertyValue;
      rentalEstimate: RentalEstimate;
      undervaluedScore: number;
    }>
  > {
    console.log(
      `Searching for undervalued properties in ${criteria.city}, ${criteria.state}...`
    );

    const properties = await this.searchProperties(criteria);
    console.log(`Found ${properties.length} properties`);

    const results: Array<{
      property: PropertyRecord;
      valueEstimate: PropertyValue;
      rentalEstimate: RentalEstimate;
      undervaluedScore: number;
    }> = [];

    for (const property of properties.slice(0, 20)) {
      const address =
        property.address ||
        `${property.latitude},${property.longitude}`;

      const [valueEstimate, rentalEstimate] = await Promise.all([
        this.getValueEstimate(
          address,
          property.propertyType,
          property.bedrooms,
          property.bathrooms,
          property.squareFootage
        ),
        this.getRentalEstimate(
          address,
          property.propertyType,
          property.bedrooms,
          property.bathrooms,
          property.squareFootage
        ),
      ]);

      if (!valueEstimate || !rentalEstimate) continue;

      const lastSale = property.lastSalePrice || 0;
      const marketValue = valueEstimate.price;
      const annualRent = rentalEstimate.rent * 12;

      let undervaluedScore = 0;

      if (lastSale > 0 && marketValue > 0) {
        const discountRatio = (marketValue - lastSale) / marketValue;
        undervaluedScore += Math.min(discountRatio * 100, 40);
      }

      if (marketValue > 0) {
        const capRate = annualRent / marketValue;
        undervaluedScore += Math.min(capRate * 100, 30);
      }

      if (valueEstimate.confidence === "High") {
        undervaluedScore += 15;
      } else if (valueEstimate.confidence === "Medium") {
        undervaluedScore += 8;
      }

      results.push({
        property,
        valueEstimate,
        rentalEstimate,
        undervaluedScore,
      });
    }

    return results.sort((a, b) => b.undervaluedScore - a.undervaluedScore);
  }
}
