"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import OrganisationCard from "@/components/organisation-card";
import { ORG_CONTACT_STATUS_LABEL, ORG_RELATIONSHIP_LABEL } from "@/lib/pipeline";
import type { OrganisationView } from "@/lib/organisations";

const CONTACT_STATUSES = ["not_contacted", "initial_email_sent", "have_a_contact"] as const;
const RELATIONSHIPS = [
  "direct_client",
  "venue_partner",
  "referral_partner",
  "agency_partner",
] as const;

export default function OrganisationsClient({
  organisations,
  canWrite,
}: {
  organisations: OrganisationView[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<string>("All");
  const [relationship, setRelationship] = useState<string>("All");
  const [status, setStatus] = useState<string>("All");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return organisations.filter((o) => {
      if (tier !== "All" && String(o.tier ?? "") !== tier) return false;
      if (relationship !== "All" && o.relationship !== relationship) return false;
      if (status !== "All" && o.contactStatus !== status) return false;
      if (needle) {
        /* Notes are searched too: they are the substance of the sheet, and
           "which one was the three-doors problem" is a real way to look. */
        const hay = [
          o.name,
          o.sector,
          o.location,
          o.notes,
          ...o.contacts.map((c) => `${c.name ?? ""} ${c.jobTitle ?? ""}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [organisations, tier, relationship, status, q]);

  const count = (fn: (o: OrganisationView) => boolean) => organisations.filter(fn).length;

  const chip = (label: string, on: boolean, onClick: () => void, n?: number) => (
    <button key={label} className="chip" type="button" aria-pressed={on} onClick={onClick}>
      {label}
      {n === undefined ? null : <span className="c">{n}</span>}
    </button>
  );

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="n">{organisations.length}</div>
          <div className="l">Organisations</div>
        </div>
        <div className="stat flag">
          <div className="n">{count((o) => o.contactStatus === "not_contacted")}</div>
          <div className="l">Never contacted</div>
        </div>
        <div className="stat">
          <div className="n">{count((o) => o.tier === 1)}</div>
          <div className="l">Tier 1</div>
        </div>
        <div className="stat">
          <div className="n">{count((o) => !!o.followUp)}</div>
          <div className="l">With a follow-up</div>
        </div>
      </div>

      <div className="controls">
        <div className="row">
          <span className="lbl">Tier</span>
          {chip("All", tier === "All", () => setTier("All"), organisations.length)}
          {["1", "2", "3"].map((t) =>
            chip(`Tier ${t}`, tier === t, () => setTier(t), count((o) => String(o.tier) === t)),
          )}
        </div>
        <div className="row">
          <span className="lbl">Relationship</span>
          {chip("All", relationship === "All", () => setRelationship("All"))}
          {RELATIONSHIPS.map((r) =>
            chip(
              ORG_RELATIONSHIP_LABEL[r],
              relationship === r,
              () => setRelationship(r),
              count((o) => o.relationship === r),
            ),
          )}
        </div>
        <div className="row">
          <span className="lbl">Contact</span>
          {chip("All", status === "All", () => setStatus("All"))}
          {CONTACT_STATUSES.map((s) =>
            chip(
              ORG_CONTACT_STATUS_LABEL[s],
              status === s,
              () => setStatus(s),
              count((o) => o.contactStatus === s),
            ),
          )}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, sector, contact, notes…"
            aria-label="Search organisations"
          />
        </div>
      </div>

      <div className="list">
        {shown.length ? (
          shown.map((o) => (
            <OrganisationCard
              key={o.id}
              org={o}
              canWrite={canWrite}
              /* Logging contact or setting a follow-up changes rows this page
                 read on the server, so re-read rather than guessing locally. */
              onChanged={() => router.refresh()}
            />
          ))
        ) : (
          <p className="empty">Nothing matches those filters.</p>
        )}
      </div>
    </>
  );
}
