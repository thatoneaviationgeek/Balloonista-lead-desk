import NextAuth from "next-auth";
import authConfig from "./auth.config";

/* Next 16 renamed `middleware.ts` to `proxy.ts`, and with a src/ directory it
   must live at src/proxy.ts — at the repo root it is silently ignored.
   This is the network-edge guard: it decides what is public and bounces
   everything else to /signin. It is the first line of defence, not the only
   one — every page and route handler checks the session for itself too. */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
