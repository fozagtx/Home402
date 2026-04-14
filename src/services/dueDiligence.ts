import { LocusClient } from "./locus";
import { OwnerVerification, TechProfile, PropertyRecord } from "../types";

export class DueDiligenceService {
  private client: LocusClient;

  constructor(client: LocusClient) {
    this.client = client;
  }

  async verifyOwner(
    property: PropertyRecord
  ): Promise<OwnerVerification | null> {
    const ownerName = property.ownerName;
    if (!ownerName) {
      const propertyOwner = await this.lookupPropertyOwner(property);
      if (propertyOwner) return propertyOwner;
      return { name: "Unknown", isValid: false };
    }

    console.log(`Verifying owner: ${ownerName}`);

    const parts = ownerName.split(" ");
    const res = await this.client.wrappedCall<Record<string, unknown>>(
      "whitepages",
      "person-search",
      {
        first_name: parts[0] || "",
        last_name: parts.slice(1).join(" ") || "",
        street: property.address,
        city: property.city,
        state_code: property.state,
        zipcode: property.zipCode,
      }
    );

    if (!res.success || !res.data) {
      console.error("Person search failed:", res.error);
      return await this.lookupPropertyOwner(property);
    }

    const data = res.data as Record<string, unknown>;
    const phoneNumbers: string[] = [];
    const emails: string[] = [];
    const addresses: string[] = [];

    if (Array.isArray(data.phones)) {
      for (const p of data.phones as Record<string, unknown>[]) {
        if (p.phone_number) phoneNumbers.push(p.phone_number as string);
      }
    }
    if (Array.isArray(data.emails)) {
      for (const e of data.emails as Record<string, unknown>[]) {
        if (e.email_address) emails.push(e.email_address as string);
      }
    }
    if (Array.isArray(data.locations)) {
      for (const l of data.locations as Record<string, unknown>[]) {
        if (l.street_line1) {
          addresses.push(
            `${l.street_line1}, ${l.city}, ${l.state_code} ${l.zipcode}`
          );
        }
      }
    }

    return {
      name: ownerName,
      phoneNumbers,
      emails,
      addresses,
      isValid: true,
      riskScore: 20,
    };
  }

  private async lookupPropertyOwner(
    property: PropertyRecord
  ): Promise<OwnerVerification | null> {
    if (!property.address) return null;

    console.log(`Looking up property owner for: ${property.address}`);

    const res = await this.client.wrappedCall<Record<string, unknown>>(
      "whitepages",
      "property-search",
      {
        street: property.address,
        city: property.city,
        state_code: property.state,
        zipcode: property.zipCode,
      }
    );

    if (!res.success || !res.data) {
      console.error("Property search failed:", res.error);
      return null;
    }

    const data = res.data as Record<string, unknown>;
    const owner = data.current_owners as Array<Record<string, unknown>>;

    if (!owner || owner.length === 0) return null;

    const primaryOwner = owner[0];
    const name = (primaryOwner.name as Record<string, unknown>) || {};
    const fullName = `${name.first_name || ""} ${name.last_name || ""}`.trim();

    return {
      name: fullName || "Unknown",
      isValid: true,
      riskScore: 25,
    };
  }

  async profileBusinessTech(
    domain: string
  ): Promise<TechProfile | null> {
    if (!domain) return null;

    console.log(`Profiling tech stack for: ${domain}`);

    const res = await this.client.wrappedCall<Record<string, unknown>>(
      "builtwith",
      "domain",
      { LOOKUP: domain, LIVEONLY: "1" }
    );

    if (!res.success || !res.data) {
      console.error("BuiltWith lookup failed:", res.error);
      return null;
    }

    const data = res.data as Record<string, unknown>;
    const paths = (data.Paths as Array<Record<string, unknown>>) || [];

    const technologies: string[] = [];
    const categories: Record<string, string[]> = {};

    for (const path of paths) {
      const techs = (path.technologies as Array<Record<string, unknown>>) || [];
      for (const tech of techs) {
        const name = (tech.Name as string) || "Unknown";
        const category = (tech.Categories as string) || "Other";
        technologies.push(name);

        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(name);
      }
    }

    const meta = (data.Meta as Record<string, unknown>) || {};

    return {
      domain,
      technologies,
      categories,
      spendEstimate: (meta.spend as number) || 0,
      firstDetected: (meta.firstDetected as string) || undefined,
      lastDetected: (meta.lastDetected as string) || undefined,
    };
  }

  async runFullDiligence(
    property: PropertyRecord
  ): Promise<{
    ownerVerification: OwnerVerification | null;
    techProfile: TechProfile | null;
    diligenceScore: number;
  }> {
    console.log(
      `Running due diligence on: ${property.address || property.id}`
    );

    const ownerVerification = await this.verifyOwner(property);

    let techProfile: TechProfile | null = null;

    const diligenceScore = 50;

    return {
      ownerVerification,
      techProfile,
      diligenceScore,
    };
  }
}
