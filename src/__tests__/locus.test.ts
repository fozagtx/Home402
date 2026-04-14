import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocusClient } from "../services/locus";

describe("LocusClient", () => {
  let client: LocusClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new LocusClient("claw_dev_test123", "https://api.paywithlocus.com/api");
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("should fetch balance successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          balance: "100.00",
          token: "USDC",
          wallet_address: "0xABC123",
        },
      }),
    });

    const balance = await client.getBalance();
    expect(balance).not.toBeNull();
    expect(balance!.balance).toBe("100.00");
    expect(balance!.token).toBe("USDC");
  });

  it("should return null on failed balance fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: "Unauthorized",
        message: "Invalid API key",
      }),
    });

    const balance = await client.getBalance();
    expect(balance).toBeNull();
  });

  it("should make wrapped API calls with correct path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: "prop1", address: "123 Main St" }],
      }),
    });

    const res = await client.wrappedCall("rentcast", "properties", {
      city: "Miami",
      state: "FL",
    });

    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.paywithlocus.com/api/wrapped/rentcast/properties",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer claw_dev_test123",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("should make x402 calls with correct path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { inboxId: "inbox_123", email: "test@agentmail.to" },
      }),
    });

    const res = await client.x402Call("agentmail-create-inbox", {
      username: "test",
    });

    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.paywithlocus.com/api/x402/agentmail-create-inbox",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should include auth header on all requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    await client.getBalance();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer claw_dev_test123",
        }),
      })
    );
  });

  it("should handle server errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: "Internal Server Error",
        message: "Something went wrong",
      }),
    });

    const res = await client.wrappedCall("rentcast", "properties", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("Internal Server Error");
  });
});
