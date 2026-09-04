"use client";

import { useState } from "react";
import { addDays } from "@/lib/dates";
import FollowUpDialog from "./follow-up-dialog";
import LogContactDialog from "./log-contact-dialog";
import { todayInLondon } from "@/lib/dates";
import {
  ACTIVITY_KIND_LABEL,
  ORG_CONTACT_STATUS_LABEL,
  ORG_RELATIONSHIP_LABEL,
  ORG_STAGES,
  type OrgStage,
  type WriteSubject,
} from "@/lib/pipeline";
import type { OrganisationView } from "@/lib/organisations";

/* Noon UTC is the same calendar day in London all year, so a date-only string
   formats without the zone shifting it. */
function humanDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function money(pence: number | null) {
  if (pence === null) return null;
  return "£" + Math.round(pence / 100).toLocaleString("en-GB");
}

export default function OrganisationCard({
  org,
  canWrite,
  onChanged,
  /* Board columns render the same card so the stage control and its follow-up
     offer are not written twice. Compact drops the detail, not the controls. */
  compact = false,
}: {
  org: OrganisationView;
  canWrite: boolean;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"log" | "follow" | null>(null);
  /* A chosen-but-not-yet-committed stage. Selecting one asks about the next
     follow-up first, so the move and the reminder land in a single request —
     moving something to "contacted" with nothing to chase it is how a thing
     goes quiet. */
  const [pending, setPending] = useState<OrgStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commitStage(stage: OrgStage, followUpDays: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${org.id}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage,
          ...(followUpDays === null
            ? {}
            : {
                next: {
                  dueAt: addDays(today, followUpDays),
                  note: `Chase after moving to ${ORG_CONTACT_STATUS_LABEL[stage]}`,
                },
              }),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Server said ${res.status}`);
      }
      setPending(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const today = todayInLondon();
  const overdue = org.followUp ? org.followUp.dueAt < today : false;
  const subject: WriteSubject = { kind: "organisation", id: org.id, title: org.name };
  const value = money(org.estimatedValuePence);

  return (
    <article className={"card org-card" + (compact ? " org-compact" : "")}>
      <div className="card-top">
        <h3>{org.name}</h3>
        {/* Tier shares the fit palette — see the warning in globals.css. Safe
            only while tier and fit never appear on the same card. */}
        {org.tier ? <span className={"tag t-tier-" + org.tier}>Tier {org.tier}</span> : null}
        {org.relationship ? (
          <span className="tag t-agent">{ORG_RELATIONSHIP_LABEL[org.relationship]}</span>
        ) : null}
        <span
          className={
            "tag " + (org.contactStatus === "not_contacted" ? "t-low" : "t-approved")
          }
        >
          {ORG_CONTACT_STATUS_LABEL[org.contactStatus]}
        </span>
        {org.followUp ? (
          <span className={"tag " + (overdue ? "t-rejected" : "t-followup")}>
            {overdue ? "Overdue " : "Follow up "}
            {humanDate(org.followUp.dueAt)}
          </span>
        ) : null}
      </div>

      {compact ? null : (
      <p className="org-meta">
        {[org.sector, org.location, value ? `${value} est.` : null].filter(Boolean).join(" · ")}
        {org.website ? (
          <>
            {" · "}
            <a href={org.website} target="_blank" rel="noopener noreferrer">
              Website
            </a>
          </>
        ) : null}
      </p>
      )}

      {compact ? null : (
      <button
        className="org-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide detail" : "Show detail"}
        <span className="org-toggle-counts">
          {org.contacts.length} contact{org.contacts.length === 1 ? "" : "s"}
          {org.activities.length ? ` · ${org.activities.length} logged` : ""}
          {org.leads.length ? ` · ${org.leads.length} lead${org.leads.length === 1 ? "" : "s"}` : ""}
          {org.notes ? " · notes" : ""}
        </span>
      </button>
      )}

      {open && !compact ? (
        <div className="org-detail">
          {org.contacts.length ? (
            <section className="org-section">
              <h4>Contacts</h4>
              <ul className="org-contacts">
                {org.contacts.map((c) => (
                  <li key={c.id}>
                    <span className="oc-name">{c.name ?? "Unnamed"}</span>
                    {c.jobTitle ? <span className="oc-role">{c.jobTitle}</span> : null}
                    {c.email ? (
                      <a className="oc-email" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                    ) : null}
                    {c.phone ? <span className="oc-phone">{c.phone}</span> : null}
                    {/* A stated gap, not a blank — the same convention the
                        scanners use when they could not verify a contact. */}
                    {c.gap ? <span className="gap oc-gap">{c.gap}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {org.notes ? (
            <section className="org-section">
              <h4>Notes</h4>
              {/* Several of these run to paragraphs of real research — the
                  substance of the spreadsheet. Rendered whole, with the line
                  breaks she typed, rather than clipped to a preview. */}
              <div className="org-notes">
                {org.notes.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          ) : null}

          {org.leads.length ? (
            <section className="org-section">
              <h4>Leads that came in through this account</h4>
              <ul className="org-leads">
                {org.leads.map((l) => (
                  <li key={l.id}>
                    <span className="tag t-agent">{l.agent}</span>
                    <a href={`/leads?focus=${l.id}`}>{l.title}</a>
                    <span className={"tag t-" + l.status.toLowerCase()}>{l.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {org.activities.length ? (
            <section className="org-section">
              <h4>History</h4>
              <ol className="history-list">
                {org.activities.map((a) => (
                  <li key={a.id}>
                    <span className="h-when">{humanDate(a.occurredAt)}</span>
                    <span className="h-kind">{ACTIVITY_KIND_LABEL[a.kind]}</span>
                    <span className="h-what">{a.summary}</span>
                    {a.contactName ? <span className="h-who">{a.contactName}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {canWrite && pending ? (
        <div className="stage-next" role="group" aria-label="Set a follow-up for this move">
          <span className="stage-next-ask">
            Moving to <strong>{ORG_CONTACT_STATUS_LABEL[pending]}</strong>. Set a follow-up?
          </span>
          {[
            { label: "1 week", days: 7 },
            { label: "2 weeks", days: 14 },
            { label: "1 month", days: 30 },
          ].map((opt, i) => (
            <button
              key={opt.days}
              className="btn"
              type="button"
              autoFocus={i === 0}
              disabled={busy}
              onClick={() => commitStage(pending, opt.days)}
            >
              {opt.label}
            </button>
          ))}
          <button className="btn" type="button" disabled={busy} onClick={() => commitStage(pending, null)}>
            Just move it
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {canWrite ? (
        <div className="actions">
          <label className="stage-pick">
            <span className="stage-pick-label">Stage</span>
            <select
              value={pending ?? org.contactStatus}
              disabled={busy}
              onChange={(e) => {
                const chosen = e.target.value as OrgStage;
                setPending(chosen === org.contactStatus ? null : chosen);
              }}
            >
              {ORG_STAGES.map((st) => (
                <option key={st} value={st}>
                  {ORG_CONTACT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
          {compact ? null : (
            <>
              <button className="btn" type="button" onClick={() => setDialog("log")}>
                Log contact
              </button>
              <button className="btn" type="button" onClick={() => setDialog("follow")}>
                {org.followUp ? "Another follow-up" : "Set follow-up"}
              </button>
            </>
          )}
        </div>
      ) : null}

      {dialog === "log" ? (
        <LogContactDialog subject={subject} onClose={() => setDialog(null)} onLogged={onChanged} />
      ) : null}
      {dialog === "follow" ? (
        <FollowUpDialog subject={subject} onClose={() => setDialog(null)} onSet={onChanged} />
      ) : null}
    </article>
  );
}
