"use client";

import { isGap, type LeadStatus, type LeadView } from "@/lib/leads";

export default function LeadCard({
  lead,
  canDecide,
  busy,
  onDecide,
}: {
  lead: LeadView;
  canDecide: boolean;
  busy: boolean;
  onDecide: (id: string, status: LeadStatus) => void;
}) {
  const done = lead.status !== "New";
  const showEntity = lead.entity && lead.entity !== "—";
  const showAddress = lead.address && lead.address !== "—";

  return (
    <article className={"card" + (done ? " done" : "") + (busy ? " busy" : "")}>
      <div className="card-top">
        <h3>{lead.title}</h3>
        <span className="tag t-agent">{lead.agent}</span>
        <span className={"tag t-" + lead.fit.toLowerCase()}>{lead.fit} fit</span>
        {done ? <span className={"tag t-" + lead.status.toLowerCase()}>{lead.status}</span> : null}
      </div>

      <p className="what">{lead.what}</p>

      <dl className="d">
        <dt>Where</dt>
        <dd>{lead.whereText ?? "—"}</dd>
        <dt>Contact</dt>
        <dd className={isGap(lead.contact) ? "gap" : undefined}>{lead.contact ?? "—"}</dd>
        {lead.role && lead.role !== "—" ? (
          <>
            <dt>Role / route</dt>
            <dd>{lead.role}</dd>
          </>
        ) : null}
        {showEntity ? (
          <>
            <dt>Hiring entity</dt>
            <dd>{lead.entity}</dd>
          </>
        ) : null}
        {showAddress ? (
          <>
            <dt>Write to</dt>
            <dd>{lead.address}</dd>
          </>
        ) : null}
        {lead.src ? (
          <>
            <dt>Source</dt>
            <dd>
              <a href={lead.src} target="_blank" rel="noopener noreferrer">
                View source
              </a>
            </dd>
          </>
        ) : null}
      </dl>

      {canDecide ? (
        <div className="actions">
          {done ? (
            <span className="said">
              {lead.status}
              {lead.statusChangedAt
                ? " on " + new Date(lead.statusChangedAt).toLocaleDateString("en-GB")
                : ""}
            </span>
          ) : (
            <span className="said">Awaiting review</span>
          )}

          {lead.status !== "Approved" ? (
            <button
              className="btn btn-ok"
              type="button"
              disabled={busy}
              onClick={() => onDecide(lead.id, "Approved")}
            >
              Approve
            </button>
          ) : null}
          {lead.status !== "Rejected" ? (
            <button
              className="btn btn-no"
              type="button"
              disabled={busy}
              onClick={() => onDecide(lead.id, "Rejected")}
            >
              Reject
            </button>
          ) : null}
          {done ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => onDecide(lead.id, "New")}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
