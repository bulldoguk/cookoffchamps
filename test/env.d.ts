import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as WorkerEnv } from "../src/worker/env";

// Types `env` from "cloudflare:workers" inside tests: the Worker's bindings plus
// the migrations vitest.config.ts passes in.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
    // Types `exports` from "cloudflare:workers" as the Worker's own module.
    interface GlobalProps {
      mainModule: typeof import("../src/worker/index");
    }
  }
}
