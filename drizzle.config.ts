import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

/* Next.js reads .env.local automatically; standalone scripts do not.
   Load .env.local first, then .env as a fallback. */
loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  /* Neon: DDL goes over the direct (unpooled) connection when one is set.
     The app itself uses the pooled DATABASE_URL. */
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)! },
  verbose: true,
  strict: true,
});
