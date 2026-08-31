import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import AppBar from "@/components/app-bar";
import LeadsClient from "./leads-client";
import { auth } from "@/auth";
import { db } from "@/db";
import { loadLeadExtras } from "@/lib/lead-extras";
import { leads as leadsTable } from "@/db/schema";
import type { LeadView } from "@/lib/leads";

export const dynamic = "force-dynamic";

const COPY = {
  UK: "Every UK opportunity the scanners have found — new store and hotel openings, film and TV productions in pre-production, and galas and balls looking for décor.",
  Dubai:
    "Every Dubai opportunity the scanners have found — hotel and retail openings, productions, and the seasonal décor moments that drive the Gulf calendar.",
} as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  /* Defence in depth: the proxy should never let an anonymous request reach
     here, but this page must not serve lead data on the assumption that it
     ran. Next's own guidance is to check the session in the page too. */
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/leads");

  const { region: raw } = await searchParams;
  const region = raw === "Dubai" ? "Dubai" : "UK";

  const rows = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.region, region)))
    .orderBy(desc(leadsTable.lastSeenAt));

  /* Three queries for the whole page rather than one per card. */
  const extras = await loadLeadExtras(
    rows.map((r) => r.id),
    session.user.id,
  );

  const leads: LeadView[] = rows.map((r) => ({
    id: r.id,
    region: r.region,
    agent: r.agent,
    title: r.title,
    fit: r.fit,
    what: r.what,
    whereText: r.whereText,
    entity: r.entity,
    address: r.address,
    contact: r.contact,
    role: r.role,
    src: r.src,
    status: r.status,
    statusChangedAt: r.statusChangedAt ? r.statusChangedAt.toISOString() : null,
    notes: r.notes,
    organisationId: r.organisationId,
    activities: extras.activities.get(r.id) ?? [],
    followUp: extras.followUp.get(r.id) ?? null,
    feedback: extras.feedback.get(r.id) ?? null,
  }));

  const newest = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.lastSeenAt > acc ? r.lastSeenAt : acc),
    null,
  );

  return (
    <>
      <AppBar current="leads" />
      <div className="wrap">
        <header className="top">
          <nav className="regionnav" aria-label="Region">
            <a href="/leads?region=UK" aria-current={region === "UK" ? "page" : undefined}>
              United Kingdom
            </a>
            <a href="/leads?region=Dubai" aria-current={region === "Dubai" ? "page" : undefined}>
              Dubai
            </a>
          </nav>
          <h1 className="brand">Lead Desk</h1>
          <p className="sub">{COPY[region]}</p>
          <div className="meta">
            <span>
              {newest
                ? "Data refreshed " + newest.toISOString().slice(0, 10)
                : "No leads loaded yet"}
            </span>
            <span>{region === "UK" ? "United Kingdom" : "Dubai"}</span>
            <span>
              {session.user.role === "viewer" ? "View only" : "Approve and reject here"}
            </span>
          </div>
        </header>

        <LeadsClient
          initialLeads={leads}
          canDecide={session.user.role === "owner" || session.user.role === "staff"}
          region={region}
        />

        <footer>
          <p>
            Leads are gathered automatically from public sources and press coverage, then checked
            by hand. Contacts marked GAP could not be verified — the scanners never invent a name
            or guess an email address. Every card links to its source; check a detail before acting
            on it. Nothing here has been sent to any company.
          </p>
        </footer>
      </div>
    </>
  );
}
