import type { Env } from "./env";
import { error, json } from "./http";

// Only /api/* reaches the Worker (run_worker_first in wrangler.jsonc); every
// other path is served from public/ by the assets binding.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return json({ ok: row?.ok === 1 });
    }

    if (url.pathname.startsWith("/api/")) {
      return error(404, "Not found");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
