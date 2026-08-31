"use client";

import { useRef, useState } from "react";
import FollowUpDialog from "./follow-up-dialog";
import LogContactDialog from "./log-contact-dialog";
import { isGap, type LeadStatus, type LeadView } from "@/lib/leads";
import { todayInLondon } from "@/lib/dates";
import {
  ACTIVITY_KIND_LABEL,
  FEEDBACK_REASONS,
  FEEDBACK_REASON_LABEL,
  type FeedbackReason,
} from "@/lib/pipeline";

/* Noon UTC is the same calendar day in London all year, so a date-only string
   formats without the zone shifting it. */
function humanDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function LeadCard({
  lead,
  canDecide,
  busy,
  onDecide,
  onChanged,
}: {
  lead: LeadView;
  canDecide: boolean;
  busy: boolean;
  onDecide: (id: string, status: LeadStatus) => void;
  onChanged: () => void;
}) {
  const done = lead.status !== "New";
  const showEntity = lead.entity && lead.entity !== "—";
  const showAddress = lead.address && lead.address !== "—";

  const [dialog, setDialog] = useState<"log" | "follow" | null>(null);
  const [askingReason, setAskingReason] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  /* Choosing a reason closes the chip row it was in, so focus has to be put
     back deliberately or it falls to <body>. */
  const notUsefulButton = useRef<HTMLButtonElement>(null);

  const overdue = lead.followUp ? lead.followUp.dueAt < todayInLondon() : false;

  async function sendFeedback(verdict: "useful" | "not_useful", reason?: FeedbackReason) {
    setSavingFeedback(true);
    setFeedbackError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Server said ${res.status}`);
      }
      setAskingReason(false);
      notUsefulButton.current?.focus();
      onChanged();
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSavingFeedback(false);
    }
  }

  return (
    <article className={"card" + (done ? " done" : "") + (busy ? " busy" : "")}>
      <div className="card-top">
        <h3>{lead.title}</h3>
        <span className="tag t-agent">{lead.agent}</span>
        <span className={"tag t-" + lead.fit.toLowerCase()}>{lead.fit} fit</span>
        {done ? <span className={"tag t-" + lead.status.toLowerCase()}>{lead.status}</span> : null}
        {lead.followUp ? (
          <span className={"tag " + (overdue ? "t-rejected" : "t-followup")}>
            {overdue ? "Overdue " : "Follow up "}
            {humanDate(lead.followUp.dueAt)}
          </span>
        ) : null}
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

      {lead.activities.length > 0 ? (
        /* Collapsed by default: the card already carries a lot, and the history
           matters when you go looking for it rather than at a glance. <details>
           gives real disclosure semantics and keyboard operation for free. */
        <details className="history">
          <summary>
            {lead.activities.length === 1 ? "1 contact logged" : `${lead.activities.length} contacts logged`}
          </summary>
          <ol className="history-list">
            {lead.activities.map((a) => (
              <li key={a.id}>
                <span className="h-when">{humanDate(a.occurredAt)}</span>
                <span className="h-kind">{ACTIVITY_KIND_LABEL[a.kind]}</span>
                <span className="h-what">{a.summary}</span>
                {a.contactName || a.organisationName ? (
                  <span className="h-who">
                    {[a.contactName, a.organisationName].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {canDecide ? (
        <>
          <div className="verdict">
            <span className="verdict-ask">Was this worth having?</span>
            {lead.feedback ? (
              <span className="verdict-said">
                {lead.feedback.verdict === "useful" ? "Marked useful" : "Not useful"}
                {lead.feedback.reason ? ` — ${FEEDBACK_REASON_LABEL[lead.feedback.reason]}` : ""}
              </span>
            ) : null}
            <button
              className="chip"
              type="button"
              aria-pressed={lead.feedback?.verdict === "useful"}
              disabled={savingFeedback}
              onClick={() => sendFeedback("useful")}
            >
              Useful
            </button>
            <button
              ref={notUsefulButton}
              className="chip"
              type="button"
              aria-pressed={lead.feedback?.verdict === "not_useful"}
              aria-expanded={askingReason}
              disabled={savingFeedback}
              onClick={() => setAskingReason((v) => !v)}
            >
              Not useful
            </button>
          </div>

          {askingReason ? (
            /* Only the no is asked to explain itself. A yes is the answer we
               want more of, so it never costs her a second click. */
            <div className="reasons" role="group" aria-label="Why was it not useful?">
              {FEEDBACK_REASONS.map((r) => (
                <button
                  key={r}
                  className="chip"
                  type="button"
                  disabled={savingFeedback}
                  onClick={() => sendFeedback("not_useful", r)}
                >
                  {FEEDBACK_REASON_LABEL[r]}
                </button>
              ))}
            </div>
          ) : null}

          {feedbackError ? (
            <p className="error" role="alert">
              {feedbackError}
            </p>
          ) : null}

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

            {/* Offered on New leads as well as approved ones. All 64 leads are
                currently New, so approved-only would hide this from the exact
                case it was built for — the dialog asks before it approves. */}
            <button className="btn" type="button" disabled={busy} onClick={() => setDialog("log")}>
              Log contact
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => setDialog("follow")}>
              {lead.followUp ? "Another follow-up" : "Set follow-up"}
            </button>
          </div>
        </>
      ) : null}

      {dialog === "log" ? (
        <LogContactDialog lead={lead} onClose={() => setDialog(null)} onLogged={onChanged} />
      ) : null}
      {dialog === "follow" ? (
        <FollowUpDialog lead={lead} onClose={() => setDialog(null)} onSet={onChanged} />
      ) : null}
    </article>
  );
}
