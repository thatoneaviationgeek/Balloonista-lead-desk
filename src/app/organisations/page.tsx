import { redirect } from "next/navigation";
import AppBar from "@/components/app-bar";
import OrganisationsClient from "./organisations-client";
import { auth } from "@/auth";
import { listOrganisations } from "@/lib/organisations";

export const dynamic = "force-dynamic";

export default async function OrganisationsPage() {
  /* Defence in depth: the proxy should never let an anonymous request reach
     here, but this page holds named contacts at other companies and must not
     serve them on the assumption that it ran. */
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/organisations");

  const organisations = await listOrganisations();

  return (
    <>
      <AppBar current="organisations" />
      <div className="wrap">
        <header className="top">
          <h1 className="brand">Organisations</h1>
          <p className="sub">
            The accounts worked over months and years, imported from the pipeline spreadsheet.
            Separate from the lead desk on purpose: the desk holds moments the scanners find,
            this holds relationships. No lead is attached to an account yet.
          </p>
          <div className="meta">
            <span>
              {organisations.length === 1
                ? "1 organisation"
                : `${organisations.length} organisations`}
            </span>
            <span>United Kingdom</span>
            <span>
              {session.user.role === "viewer" ? "View only" : "Log contact and set follow-ups here"}
            </span>
          </div>
        </header>

        <OrganisationsClient
          organisations={organisations}
          canWrite={session.user.role === "owner" || session.user.role === "staff"}
        />

        <footer>
          <p>
            These are named people at other companies, held for ordinary business contact and
            visible only behind this login. Nothing here emails anyone — logging contact records
            that a person made it. Where an address could not be verified the row says so rather
            than sitting blank, the same convention the scanners use.
          </p>
        </footer>
      </div>
    </>
  );
}
