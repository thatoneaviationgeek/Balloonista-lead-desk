/**
 * Add or update someone on the login allow-list.
 *
 *   npm run people:add -- aurelija@example.com owner "Aurelija"
 *   npm run people:add -- someone@example.com staff
 *
 * With no arguments it lists everyone.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { people } from "../db/schema";

const ROLES = new Set(["owner", "staff", "viewer"]);

async function main() {
  const [email, role = "staff", ...nameParts] = process.argv.slice(2);

  if (!email) {
    const all = await db.select().from(people).orderBy(people.email);
    if (!all.length) {
      console.log("Nobody on the allow-list yet.");
      return;
    }
    for (const p of all) {
      console.log(`${p.active ? "•" : "×"} ${p.email.padEnd(34)} ${p.role}${p.name ? "  " + p.name : ""}`);
    }
    return;
  }

  if (!ROLES.has(role)) {
    console.error(`Role must be one of: ${[...ROLES].join(", ")}`);
    process.exit(1);
  }

  const name = nameParts.join(" ") || null;
  const value = {
    email: email.toLowerCase(),
    role: role as "owner" | "staff" | "viewer",
    name,
    active: true,
  };

  await db
    .insert(people)
    .values(value)
    .onConflictDoUpdate({ target: people.email, set: { role: value.role, active: true, name } });

  const [row] = await db.select().from(people).where(eq(people.email, value.email));
  console.log(`Saved: ${row.email} (${row.role})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
