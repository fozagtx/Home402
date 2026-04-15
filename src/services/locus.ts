import { LocusResponse, LocusBalance } from "../types";

export class LocusClient {
  private apiKey: string;
  private apiBase: string;

  constructor(apiKey: string, apiBase: string) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>
  ): Promise<LocusResponse<T>> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === "POST") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data: any = await response.json();

    if (!response.ok) {
      console.error(
        `Locus API error [${response.status}]: ${data.message || data.error}`
      );
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
        message: data.message,
      };
    }

    return data as LocusResponse<T>;
  }

  async getBalance(): Promise<LocusBalance | null> {
    const res = await this.request<any>("/pay/balance");
    if (!res.success || !res.data) return null;
    const d = res.data;
    return {
      balance: d.usdc_balance ?? d.balance ?? "0",
      token: "USDC",
      wallet_address: d.wallet_address ?? "",
    };
  }

  async wrappedCall<T>(
    provider: string,
    endpoint: string,
    params: Record<string, unknown>
  ): Promise<LocusResponse<T>> {
    return this.request<T>(
      `/wrapped/${provider}/${endpoint}`,
      "POST",
      params
    );
  }

  async x402Call<T>(
    slug: string,
    params: Record<string, unknown>
  ): Promise<LocusResponse<T>> {
    return this.request<T>(`/x402/${slug}`, "POST", params);
  }

  async sendUsdc(
    toAddress: string,
    amount: number,
    memo: string
  ): Promise<LocusResponse<unknown>> {
    return this.request("/pay/send", "POST", {
      to_address: toAddress,
      amount,
      memo,
    });
  }

  async sendUsdcEmail(
    email: string,
    amount: number,
    memo: string,
    expiresInDays = 30
  ): Promise<LocusResponse<unknown>> {
    return this.request("/pay/send-email", "POST", {
      email,
      amount,
      memo,
      expires_in_days: expiresInDays,
    });
  }

  async getTransactions(
    limit = 50,
    status?: string
  ): Promise<LocusResponse<unknown>> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);
    return this.request(`/pay/transactions?${params.toString()}`);
  }

  async submitFeedback(
    category: string,
    message: string,
    endpoint?: string,
    context?: Record<string, unknown>,
    source = "manual"
  ): Promise<void> {
    await this.request("/feedback", "POST", {
      category,
      message,
      endpoint,
      context,
      source,
    });
  }
}
