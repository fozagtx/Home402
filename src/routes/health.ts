import {
  type Route,
  type RouteRequest,
  type RouteResponse,
  type IAgentRuntime,
} from "@elizaos/core";

const startedAt = Date.now();

/**
 * GET /health — Nosana health check endpoint.
 *
 * Returns 200 with a small JSON payload describing agent liveness so the
 * Nosana supervisor (and any external monitoring) can confirm the container
 * is up and the ElizaOS runtime is responsive.
 */
export const healthRoute: Route = {
  type: "GET",
  path: "/health",
  public: true,
  name: "health",
  handler: async (
    _req: RouteRequest,
    res: RouteResponse,
    runtime: IAgentRuntime
  ): Promise<void> => {
    const uptimeMs = Date.now() - startedAt;
    res.status(200).json({
      status: "ok",
      agent: runtime.character?.name ?? "SolSentinel",
      uptimeMs,
      uptimeSec: Math.round(uptimeMs / 1000),
      timestamp: new Date().toISOString(),
    });
  },
};
