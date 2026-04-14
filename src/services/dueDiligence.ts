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
      return {
        name: "Unknown",
        isValid: false,
      };
    }

    console.log(`Verifying owner: ${ownerName}`);

    const params: Record<string, unknown> = {
      first_name: ownerName.split(" ")[0] || "",
      last_name: ownerName.split(" ").slice(1).join(" ") || "",
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zipCode,
    };

    const res = await this.client.wrappedCall<Record<string, unknown>>(
      "whitepages-pro",
      "identity-check",
      params
    );

    if (!res.success || !res.data) {
      console.error("Owner verification failed:", res.error);

      return await this.fallbackVerify(property);
    }

    const data = res.data;
    return {
      name: ownerName,
      phoneNumbers: (data.phoneNumbers as string[]) || [],
      emails: (data.emails as string[]) || [],
      addresses: (data.addresses as string[]) || [],
      isValid: (data.isValid as boolean) || false,
      riskScore: (data.riskScore as number) || 50,
    };
  }

  private async fallbackVerify(
    property: PropertyRecord
  ): Promise<OwnerVerification> {
    const ownerName = property.ownerName || "Unknown";
    let isValid = false;
    let emails: string[] = [];

    if (property.address) {
      const emailRes = await this.client.wrappedCall<Record<string, unknown>>(
        "abstract-api",
        "email-validation",
        { email: property.ownerName }
      );

      if (emailRes.success && emailRes.data) {
        isValid = emailRes.data.is_valid as boolean;
      }
    }

    return {
      name: ownerName,
      emails,
      isValid,
      riskScore: isValid ? 30 : 70,
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

  async getTrustScore(domain: string): Promise<number> {
    const res = await this.client.wrappedCall<Record<string, unknown>>(
      "builtwith",
      "trust",
      { LOOKUP: domain }
    );

    if (!res.success || !res.data) return 50;

    const data = res.data as Record<string, unknown>;
    return (data.trustScore as number) || 50;
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
    if (property.ownerName) {
      const possibleDomain = property.ownerName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      techProfile = await this.profileBusinessTech(
        `${possibleDomain}.com`
      );
    }

    let diligenceScore = 50;

    if (ownerVerification) {
      if (ownerVerification.isValid) diligenceScore += 20;
      if (ownerVerification.emails && ownerVerification.emails.length > 0)
        diligenceScore += 10;
      if (
        ownerVerification.riskScore !== undefined &&
        ownerVerification.riskScore < 30
      )
        diligenceScore += 10;
    }

    if (techProfile) {
      if (techProfile.technologies.length > 0) diligenceScore += 5;
      if (techProfile.spendEstimate && techProfile.spendEstimate > 0)
        diligenceScore += 5;
    }

    diligenceScore = Math.min(diligenceScore, 100);

    return {
      ownerVerification,
      techProfile,
      diligenceScore,
    };
  }
}
