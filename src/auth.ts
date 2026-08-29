import NextAuth from "next-auth";
import { eq } from "drizzle-orm";
import authConfig from "./auth.config";
import { db } from "@/db";
import { people } from "@/db/schema";

export type AppRole = "owner" | "staff" | "viewer";

/** Who is allowed in: a row in `people` (active), or the Workspace domain. */
async function resolvePerson(email: string) {
  const rows = await db.select().from(people).where(eq(people.email, email)).limit(1);
  const existing = rows[0];
  if (existing) return existing.active ? existing : null;

  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase().trim();
  if (!domain || !email.toLowerCase().endsWith("@" + domain)) return null;

  /* First sign-in from the Workspace domain: create the person as staff.
     Promote to owner by hand, or with `npm run seed:people`. */
  const inserted = await db
    .insert(people)
    .values({ email, role: "staff" })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, profile }) {
      const email = (user.email ?? profile?.email ?? "").toLowerCase();
      if (!email) {
        console.warn("[auth] refused: Google returned no email address");
        return false;
      }
      if (profile && profile.email_verified === false) {
        console.warn(`[auth] refused ${email}: Google says the address is not verified`);
        return false;
      }

      let person;
      try {
        person = await resolvePerson(email);
      } catch (error) {
        console.error(`[auth] database error while checking ${email}:`, error);
        return false;
      }

      if (!person) {
        const domain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase().trim();
        console.warn(
          `[auth] refused ${email}: not on the allow-list` +
            (domain
              ? ` and not on @${domain}. Add them with: npm run people:add -- ${email} staff`
              : ` and ALLOWED_EMAIL_DOMAIN is not set. Add them with: npm run people:add -- ${email} staff`),
        );
        return false;
      }

      console.log(`[auth] admitted ${email} as ${person.role}`);

      await db
        .update(people)
        .set({
          lastSeenAt: new Date(),
          name: person.name ?? user.name ?? null,
          image: person.image ?? user.image ?? null,
        })
        .where(eq(people.id, person.id));
      return true;
    },

    async jwt({ token, trigger }) {
      if (!token.email) return token;
      if (token.personId && trigger !== "signIn") return token;
      const rows = await db
        .select()
        .from(people)
        .where(eq(people.email, token.email.toLowerCase()))
        .limit(1);
      const person = rows[0];
      if (person) {
        token.personId = person.id;
        token.role = person.role;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.personId as string) ?? "";
        session.user.role = (token.role as AppRole) ?? "viewer";
      }
      return session;
    },
  },
});
