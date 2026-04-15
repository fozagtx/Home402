import { LocusClient } from "./locus";
import { Lead, OwnerVerification } from "../types";

export class OutreachService {
  private client: LocusClient;
  private inboxId: string | null = null;
  private inboxEmail: string | null = null;

  constructor(client: LocusClient) {
    this.client = client;
  }

  async setupEmailInbox(username: string): Promise<{
    inboxId: string;
    email: string;
  } | null> {
    const email = `${username}@agentmail.to`;
    this.inboxId = email;
    this.inboxEmail = email;

    const check = await this.client.x402Call<{ count: number }>(
      "agentmail-list-messages",
      { inbox_id: this.inboxId }
    );

    if (check.success) {
      console.log(`Inbox ready: ${email}`);
      return { inboxId: this.inboxId, email: this.inboxEmail };
    }

    console.log(`Inbox not found, creating: ${email}`);
    const res = await this.client.x402Call<{
      inboxId: string;
      email: string;
    }>("agentmail-create-inbox", { username });

    if (!res.success || !res.data) {
      console.error("Failed to create inbox:", res.error, res.message);
      return null;
    }

    this.inboxId = res.data.inboxId;
    this.inboxEmail = res.data.email;
    console.log(`Inbox created: ${res.data.email}`);
    return res.data;
  }

  async sendEmail(
    toEmail: string,
    subject: string,
    body: string
  ): Promise<boolean> {
    if (!this.inboxId) {
      console.error("No inbox set up. Call setupEmailInbox() first.");
      return false;
    }

    console.log(`Sending email to: ${toEmail}`);

    let res = await this.client.x402Call<unknown>(
      "agentmail-send-message",
      {
        to: toEmail,
        subject,
        text: body,
      }
    );

    if (!res.success && res.error?.includes("Validation")) {
      res = await this.client.x402Call<unknown>(
        "agentmail-send-message",
        {
          inbox_id: this.inboxId,
          to: [{ email: toEmail }],
          subject,
          body,
        }
      );
    }

    if (!res.success) {
      console.error("Failed to send email:", res.error);
      return false;
    }

    console.log(`Email sent to ${toEmail}`);
    return true;
  }

  async checkForReplies(): Promise<
    Array<{
      messageId: string;
      from: string;
      subject: string;
      snippet: string;
      receivedAt: string;
    }>
  > {
    if (!this.inboxId) {
      console.error("No inbox set up.");
      return [];
    }

    const res = await this.client.x402Call<{
      messages: Array<{
        id: string;
        from: string;
        subject: string;
        snippet: string;
        receivedAt: string;
      }>;
    }>("agentmail-list-messages", {
      inbox_id: this.inboxId,
    });

    if (!res.success || !res.data) {
      console.error("Failed to check replies:", res.error);
      return [];
    }

    return (res.data.messages || []).map((m) => ({
      messageId: m.id,
      from: m.from,
      subject: m.subject,
      snippet: m.snippet,
      receivedAt: m.receivedAt,
    }));
  }

  async replyToMessage(
    messageId: string,
    body: string
  ): Promise<boolean> {
    if (!this.inboxId) return false;

    const res = await this.client.x402Call<unknown>(
      "agentmail-reply",
      {
        inbox_id: this.inboxId,
        message_id: messageId,
        text: body,
      }
    );

    return res.success;
  }
}
