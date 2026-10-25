import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs before each test file. Applying is idempotent, so a reused database is fine.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
