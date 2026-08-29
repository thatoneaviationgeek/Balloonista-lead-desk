import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof make>;

function make() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon connection string.",
    );
  }
  return drizzle(neon(url), { schema });
}

let cached: Db | undefined;

/* Lazy so that `next build` does not need a database to be reachable. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    cached ??= make();
    return Reflect.get(cached, prop, cached);
  },
});

export { schema };
