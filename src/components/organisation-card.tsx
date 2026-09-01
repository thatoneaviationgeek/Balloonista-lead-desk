"use client";

import { useState } from "react";
import FollowUpDialog from "./follow-up-dialog";
import LogContactDialog from "./log-contact-dialog";
import { todayInLondon } from "@/lib/dates";
import {
  ACTIVITY_KIND_LABEL,
  ORG_CONTACT_STATUS_LABEL,
  ORG_RELATIONSHIP_LABEL,
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
}: {
  org: OrganisationView;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"log" | "follow" | null>(null);

  const overdue = org.followUp ? org.followUp.dueAt < todayInLondon() : false;
  const subject: WriteSubject = { kind: "organisation", id: org.id, title: org.name };
  const value = money(org.estimatedValuePence);

  return (
    <article className="card org-card">
      <div className="card-top">
        <h3>{org.name}</h3>
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
          {org.notes ? " · notes" : ""}
        </span>
      </button>

      {open ? (
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

      {canWrite ? (
        <div className="actions">
          <button className="btn" type="button" onClick={() => setDialog("log")}>
            Log contact
          </button>
          <button className="btn" type="button" onClick={() => setDialog("follow")}>
            {org.followUp ? "Another follow-up" : "Set follow-up"}
          </button>
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
