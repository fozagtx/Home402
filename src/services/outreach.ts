import { LocusClient } from "./locus";
import { Lead, OutreachMethod, OwnerVerification } from "../types";

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
    console.log(`Setting up AgentMail inbox: ${username}@agentmail.to`);

    const res = await this.client.x402Call<{
      inboxId: string;
      email: string;
    }>("agentmail-create-inbox", {
      username,
    });

    if (!res.success || !res.data) {
      console.error("Failed to create inbox:", res.error);
      return null;
    }

    this.inboxId = res.data.inboxId;
    this.inboxEmail = res.data.email;

    console.log(`Inbox created: ${res.data.email}`);
    return res.data;
  }

  async sendOfferEmail(
    toEmail: string,
    lead: Lead,
    customMessage?: string
  ): Promise<boolean> {
    if (!this.inboxId) {
      console.error("No inbox set up. Call setupEmailInbox() first.");
      return false;
    }

    const property = lead.property;
    const address =
      property.address || `${property.city}, ${property.state}`;
    const valueStr = lead.valueEstimate
      ? `$${lead.valueEstimate.price.toLocaleString()}`
      : "market value";

    const subject = `Interest in Your Property at ${address}`;
    const body =
      customMessage ||
      this.generateOfferEmail(address, valueStr, lead);

    console.log(`Sending offer email to: ${toEmail}`);

    const res = await this.client.x402Call<unknown>(
      "agentmail-send-message",
      {
        inbox_id: this.inboxId,
        to: [{ email: toEmail }],
        subject,
        body,
      }
    );

    if (!res.success) {
      console.error("Failed to send email:", res.error);
      return false;
    }

    console.log(`Offer email sent to ${toEmail}`);
    return true;
  }

  private generateOfferEmail(
    address: string,
    valueStr: string,
    lead: Lead
  ): string {
    const rentalStr = lead.rentalEstimate
      ? ` Current rental estimates suggest $${lead.rentalEstimate.rent.toLocaleString()}/month.`
      : "";

    return `Dear Property Owner,

I'm reaching out regarding your property at ${address}. 

Our automated analysis indicates this property has an estimated market value of ${valueStr}.${rentalStr}

We're actively seeking commercial real estate opportunities in this area and would like to discuss a potential acquisition. We can close quickly and handle all transaction details.

If you're interested in exploring this opportunity, please reply to this email or contact us directly.

Best regards,
Home402 Autonomous Lead Hunter
Powered by Locus (USDC payments on Base)`;
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
        body,
      }
    );

    return res.success;
  }

  async searchTwitterOwner(
    ownerName: string,
    location: string
  ): Promise<string | null> {
    const query = `${ownerName} ${location}`;

    const res = await this.client.wrappedCall<{
      data: Array<{ id: string; username: string; name: string }>;
    }>("x-twitter", "search-users", {
      query,
      "user.fields": "username,name,location,public_metrics",
      max_results: 5,
    });

    if (!res.success || !res.data || !res.data.data?.length) {
      console.error("Twitter user search failed:", res.error);
      return null;
    }

    return `@${res.data.data[0].username}`;
  }

  async sendTwitterDM(
    userId: string,
    message: string
  ): Promise<boolean> {
    console.log(`Twitter outreach is read-only via wrapped API.`);
    console.log(
      `Would send to user ${userId}: ${message.substring(0, 80)}...`
    );
    return false;
  }

  async determineOutreachMethod(
    owner: OwnerVerification | null | undefined
  ): Promise<OutreachMethod> {
    if (owner?.emails && owner.emails.length > 0) {
      return OutreachMethod.EMAIL;
    }
    return OutreachMethod.EMAIL;
  }

  async executeOutreach(lead: Lead): Promise<{
    success: boolean;
    method: OutreachMethod;
    sentAt: string;
  }> {
    const method = await this.determineOutreachMethod(
      lead.ownerVerification
    );

    let success = false;

    if (method === OutreachMethod.EMAIL) {
      const email = lead.ownerVerification?.emails?.[0];

      if (!email) {
        console.error(
          `No verified email for lead ${lead.id}. Cannot reach out.`
        );
        return { success: false, method, sentAt: new Date().toISOString() };
      }

      success = await this.sendOfferEmail(email, lead);
    }

    return {
      success,
      method,
      sentAt: new Date().toISOString(),
    };
  }
}
