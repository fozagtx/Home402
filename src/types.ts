export interface PropertyRecord {
  id: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  lotSize: number;
  yearBuilt: number;
  ownerName?: string;
  ownerAddress?: string;
  assessedValue?: number;
  marketValue?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxHistory?: Array<{
    year: number;
    assessed: number;
    tax: number;
  }>;
}

export interface PropertyValue {
  price: number;
  priceLow: number;
  priceHigh: number;
  confidence: string;
  comparables: Array<{
    address: string;
    price: number;
    distance: number;
    daysAgo: number;
  }>;
}

export interface RentalEstimate {
  rent: number;
  rentLow: number;
  rentHigh: number;
  confidence: string;
  comparables: Array<{
    address: string;
    rent: number;
    distance: number;
    daysAgo: number;
  }>;
}

export interface MarketStats {
  zipCode: string;
  dataType: string;
  saleMedian?: number;
  rentalMedian?: number;
  daysOnMarket?: number;
  inventory?: number;
  history?: Array<{
    month: string;
    medianPrice: number;
    listings: number;
  }>;
}

export interface GeoCoordinate {
  longitude: number;
  latitude: number;
  placeName: string;
}

export interface OwnerVerification {
  name: string;
  phoneNumbers?: string[];
  emails?: string[];
  addresses?: string[];
  isValid: boolean;
  riskScore?: number;
}

export interface TechProfile {
  domain: string;
  technologies: string[];
  categories: Record<string, string[]>;
  spendEstimate?: number;
  firstDetected?: string;
  lastDetected?: string;
}

export interface Lead {
  id: string;
  property: PropertyRecord;
  valueEstimate?: PropertyValue;
  rentalEstimate?: RentalEstimate;
  marketStats?: MarketStats;
  ownerVerification?: OwnerVerification;
  techProfile?: TechProfile;
  score: number;
  status: LeadStatus;
  outreachMethod?: OutreachMethod;
  outreachSentAt?: string;
  ownerRespondedAt?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export enum LeadStatus {
  DISCOVERED = "discovered",
  ENRICHED = "enriched",
  SCORED = "scored",
  OUTREACH_QUEUED = "outreach_queued",
  OUTREACH_SENT = "outreach_sent",
  OWNER_RESPONDED = "owner_responded",
  QUALIFIED = "qualified",
  LOST = "lost",
}

export enum OutreachMethod {
  EMAIL = "email",
  TWITTER = "twitter",
}

export interface SearchCriteria {
  city: string;
  state: string;
  propertyType?: string;
  zipCode?: string;
  radius?: number;
  minBedrooms?: number;
  maxPrice?: string;
  limit?: number;
}

export interface AgentConfig {
  locusApiKey: string;
  locusApiBase: string;
  searchCity: string;
  searchState: string;
  searchPropertyType: string;
  searchRadius: number;
  leadScoreThreshold: number;
  agentmailUsername: string;
  twitterHandle: string;
}

export interface LocusResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface LocusBalance {
  balance: string;
  token: string;
  wallet_address: string;
}
