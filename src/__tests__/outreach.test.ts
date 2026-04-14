import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutreachService } from "../services/outreach";
import { LocusClient } from "../services/locus";

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

  it("should send an email with subject and body", async () => {
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

    const result = await service.sendEmail(
      "owner@example.com",
      "Interest in Your Property",
      "Dear Owner, we'd like to discuss..."
    );
    expect(result).toBe(true);
  });

  it("should fail to send email without inbox setup", async () => {
    const result = await service.sendEmail(
      "owner@example.com",
      "Test",
      "Body"
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

  it("should reply to a message", async () => {
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

    const result = await service.replyToMessage("msg_1", "Thanks for your reply!");
    expect(result).toBe(true);
  });
});
