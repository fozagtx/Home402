import Supermemory from "supermemory";

export class MemoryService {
  private client!: Supermemory;
  private enabled: boolean;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.client = new Supermemory({ apiKey });
      this.enabled = true;
      console.log("Supermemory enabled");
    } else {
      this.enabled = false;
      console.log("Supermemory disabled (no SUPERMEMORY_API_KEY)");
    }
  }

  async recall(userId: string, query: string): Promise<string> {
    if (!this.enabled) return "";

    try {
      const profile = await this.client.profile({
        containerTag: userId,
        q: query,
      });

      const parts: string[] = [];

      if (profile.profile.static.length > 0) {
        parts.push("Known facts about user: " + profile.profile.static.join("; "));
      }
      if (profile.profile.dynamic.length > 0) {
        parts.push("Recent context: " + profile.profile.dynamic.join("; "));
      }
      if (profile.searchResults?.results?.length) {
        const memories = profile.searchResults.results
          .map((r: any) => r.memory || "")
          .filter(Boolean)
          .join("; ");
        if (memories) parts.push("Relevant memories: " + memories);
      }

      return parts.join("\n");
    } catch (err) {
      console.error("Supermemory recall failed:", (err as Error).message);
      return "";
    }
  }

  async remember(userId: string, conversation: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.client.add({
        content: conversation,
        containerTag: userId,
      });
    } catch (err) {
      console.error("Supermemory store failed:", (err as Error).message);
    }
  }

  async forget(userId: string, query: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.client.memories.forget({
        containerTag: userId,
        content: query,
      });
    } catch (err) {
      console.error("Supermemory forget failed:", (err as Error).message);
    }
  }

  async search(userId: string, query: string): Promise<string[]> {
    if (!this.enabled) return [];

    try {
      const results = await this.client.search.memories({
        q: query,
        containerTag: userId,
        searchMode: "memories",
      });

      return results.results
        .map((r: any) => r.memory || "")
        .filter(Boolean);
    } catch (err) {
      console.error("Supermemory search failed:", (err as Error).message);
      return [];
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
