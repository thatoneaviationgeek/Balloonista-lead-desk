import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/* Edge-safe half of the auth setup: no database imports live in here, because
   this is what middleware loads on every request. */

export const PUBLIC_PATHS = ["/signin", "/api/leads/ingest", "/api/health"];

export default {
  providers: [Google],
  pages: { signIn: "/signin", error: "/signin" },
  trustHost: true,
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return true;
      }
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
