import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, generateObject } from "ai";
import { z } from "zod";

export class LLMService {
  private model;
  private modelId: string;

  constructor(apiKey: string, model = "google/gemini-2.0-flash-001") {
    const provider = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      headers: {
        "HTTP-Referer": "https://paywithlocus.com",
      },
    });

    this.modelId = model;
    this.model = provider.chatModel(model);
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string | null> {
    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userMessage,
        temperature: 0.7,
      });
      return result.text;
    } catch (err) {
      console.error(`LLM chat failed [${this.modelId}]:`, (err as Error).message);
      return null;
    }
  }

  async analyzeProperty(propertyData: string): Promise<{
    shouldPursue: boolean;
    score: number;
    reasoning: string;
    strategy: string;
  } | null> {
    try {
      const result = await generateObject({
        model: this.model,
        system:
          "You are a commercial real estate investment analyst. Analyze properties and decide if they are worth pursuing. " +
          "Be aggressive but smart — you're looking for undervalued commercial properties with real upside. " +
          "Consider value gap, rental yield, location, property type, and any owner/business signals.",
        prompt: `Analyze this property and decide if we should pursue it:\n\n${propertyData}`,
        schema: z.object({
          shouldPursue: z.boolean().describe("Whether this property is worth pursuing"),
          score: z.number().min(0).max(100).describe("Investment attractiveness score"),
          reasoning: z.string().describe("Why you scored it this way — be specific about upside and risks"),
          strategy: z.string().describe("Recommended approach for this lead — what angle to take with the owner"),
        }),
        temperature: 0.5,
      });
      return result.object;
    } catch (err) {
      console.error("Property analysis failed:", (err as Error).message);
      return null;
    }
  }

  async generateOutreachEmail(
    propertySummary: string,
    ownerInfo: string,
    strategy: string
  ): Promise<{
    subject: string;
    body: string;
  } | null> {
    try {
      const result = await generateObject({
        model: this.model,
        system:
          "You are a commercial real estate acquisitions specialist. Write compelling, personalized outreach emails to property owners. " +
          "Be professional but direct. Show you've done your homework. Keep it concise — owners are busy. " +
          "Never use generic templates. Every email should reference specific details about their property.",
        prompt:
          `Write a personalized outreach email to the owner of this property.\n\n` +
          `PROPERTY:\n${propertySummary}\n\n` +
          `OWNER INFO:\n${ownerInfo}\n\n` +
          `STRATEGY: ${strategy}\n\n` +
          `The email should come from Home402 Acquisitions. Sign off as "Home402 Acquisitions Team".`,
        schema: z.object({
          subject: z.string().describe("Compelling email subject line"),
          body: z.string().describe("Full email body — professional, personalized, concise"),
        }),
        temperature: 0.8,
      });
      return result.object;
    } catch (err) {
      console.error("Email generation failed:", (err as Error).message);
      return null;
    }
  }

  async analyzeReply(
    originalEmail: string,
    ownerReply: string,
    propertySummary: string
  ): Promise<{
    sentiment: "positive" | "neutral" | "negative";
    interest: "hot" | "warm" | "cold";
    nextStep: string;
    shouldEscalate: boolean;
    suggestedResponse: string;
  } | null> {
    try {
      const result = await generateObject({
        model: this.model,
        system:
          "You are a real estate deal analyst. Analyze owner replies to our acquisition outreach. " +
          "Determine how interested they are and what the agent should do next. Be realistic.",
        prompt:
          `We sent this email:\n${originalEmail}\n\n` +
          `The owner replied:\n${ownerReply}\n\n` +
          `Property context:\n${propertySummary}\n\n` +
          `Analyze the reply and recommend next steps.`,
        schema: z.object({
          sentiment: z.enum(["positive", "neutral", "negative"]).describe("Overall sentiment of the reply"),
          interest: z.enum(["hot", "warm", "cold"]).describe("How interested the owner seems"),
          nextStep: z.string().describe("What the agent should do next — be specific"),
          shouldEscalate: z.boolean().describe("Whether to notify the human operator immediately"),
          suggestedResponse: z.string().describe("Draft a reply to the owner"),
        }),
        temperature: 0.5,
      });
      return result.object;
    } catch (err) {
      console.error("Reply analysis failed:", (err as Error).message);
      return null;
    }
  }

  private escapeMd(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
  }

  async formatTelegramMessage(
    context: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const dataStr = JSON.stringify(data, null, 2);
    try {
      const result = await generateText({
        model: this.model,
        system:
          "You are a Telegram message formatter. Output ONLY the message text in valid Telegram MarkdownV2 format. " +
          "Escape these chars with backslash in plain text: _ * [ ] ( ) ~ ` > # + - = | { } . ! " +
          "Use *bold* for headings and emphasis. Be concise, scannable, use emojis sparingly. " +
          "Do NOT wrap in code blocks. Do NOT add explanation. Just the message. " +
          "Do NOT invent data not provided. Only use what is in the data.",
        prompt: `Context: ${context}\n\nData:\n${dataStr}`,
        temperature: 0.3,
      });
      const msg = result.text.trim();
      return msg || this.escapeMd(`${context}\n${dataStr}`);
    } catch (err) {
      console.error("Telegram message formatting failed:", (err as Error).message);
      return this.escapeMd(`${context}\n${dataStr}`);
    }
  }

  async decideOutreachMethod(
    ownerInfo: string,
    propertySummary: string
  ): Promise<{
    method: "email" | "skip";
    reasoning: string;
  } | null> {
    try {
      const result = await generateObject({
        model: this.model,
        system:
          "You are a real estate outreach strategist. Decide the best way to reach a property owner. " +
          "If there's not enough verified contact info, recommend skipping.",
        prompt:
          `Owner info:\n${ownerInfo}\n\nProperty:\n${propertySummary}\n\n` +
          `Should we email this owner, or skip them due to missing/invalid info?`,
        schema: z.object({
          method: z.enum(["email", "skip"]).describe("email if we have a verified address, skip otherwise"),
          reasoning: z.string().describe("Why this method"),
        }),
        temperature: 0.3,
      });
      return result.object;
    } catch (err) {
      console.error("Outreach decision failed:", (err as Error).message);
      return null;
    }
  }
}
