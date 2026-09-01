"use client";

import { useState } from "react";
import Modal from "./modal";
import { todayInLondon } from "@/lib/dates";
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABEL,
  subjectLinks,
  type ActivityKind,
  type WriteSubject,
} from "@/lib/pipeline";

/**
 * Record that she made contact. Nothing here sends anything — it writes down
 * what she did from her own inbox.
 *
 * A contact who is not on file yet is created here rather than sending her
 * somewhere else first, which is the whole point: at the moment she wants to
 * log an email, being told to go and create an organisation record would lose
 * her.
 */
export default function LogContactDialog({
  subject,
  onClose,
  onLogged,
}: {
  subject: WriteSubject;
  onClose: () => void;
  onLogged: (result: { leadApproved: boolean }) => void;
}) {
  const today = todayInLondon();
  const [kind, setKind] = useState<ActivityKind>("email_sent");
  const [occurredAt, setOccurredAt] = useState(today);
  const [summary, setSummary] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [gap, setGap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Set when the API answers 409: the lead is still New and logging contact
     will approve it. She is asked before it happens, never after. Only a lead
     can raise this — an organisation has no status to approve. */
  const [confirmApproval, setConfirmApproval] = useState(false);

  /* An organisation subject already is the organisation. A lead only needs one
     when it has not been attached to an account yet. */
  const needsOrganisation = subject.kind === "lead" && !subject.organisationId;

  async function submit(approveLead: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          occurredAt,
          summary,
          ...subjectLinks(subject),
          ...(approveLead ? { approveLead: true } : {}),
          ...(needsOrganisation && organisation.trim()
            ? {
                newOrganisation: {
                  name: organisation.trim(),
                  region: subject.kind === "lead" ? subject.region : "UK",
                },
              }
            : {}),
          ...(contactName.trim() || email.trim() || gap.trim()
            ? {
                newContact: {
                  name: contactName.trim() || null,
                  email: email.trim() || null,
                  gap: gap.trim() || null,
                },
              }
            : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 409 && payload.code === "lead_approval_required") {
        setConfirmApproval(true);
        return;
      }
      if (!res.ok) throw new Error(payload.error || `Server said ${res.status}`);

      onLogged({ leadApproved: !!payload.leadApproved });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirmApproval) {
    return (
      <Modal
        title="This will approve the lead"
        description={`“${subject.title}” is still awaiting review. Logging contact against it will mark it Approved, because a lead you have emailed is one you have decided to pursue.`}
        onClose={onClose}
      >
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="btn btn-ok" type="button" disabled={busy} onClick={() => submit(true)}>
            Log it and approve
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => setConfirmApproval(false)}>
            Back
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Log contact"
      description={`Against “${subject.title}”. This records what you did — it does not send anything.`}
      onClose={onClose}
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <p className="fld">
          <label htmlFor="lc-kind">What happened</label>
          <select
            id="lc-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
          >
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </p>

        <p className="fld">
          <label htmlFor="lc-date">When</label>
          <input
            id="lc-date"
            type="date"
            value={occurredAt}
            max={today}
            onChange={(e) => setOccurredAt(e.target.value)}
            required
          />
        </p>

        <p className="fld">
          <label htmlFor="lc-summary">One line on what happened</label>
          <input
            id="lc-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Emailed about the gala"
            required
          />
        </p>

        {needsOrganisation ? (
          <p className="fld">
            <label htmlFor="lc-org">Organisation</label>
            <input
              id="lc-org"
              type="text"
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              placeholder="Who they are"
            />
            <span className="hint">
              Created if it is not on file yet. Leave blank to log against the lead alone.
            </span>
          </p>
        ) : null}

        <fieldset className="sub-fields">
          <legend>Who you dealt with — optional</legend>
          <p className="fld">
            <label htmlFor="lc-contact">Name</label>
            <input
              id="lc-contact"
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </p>
          <p className="fld">
            <label htmlFor="lc-email">Email</label>
            <input
              id="lc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p className="fld">
            <label htmlFor="lc-gap">If there is no address, say what is known</label>
            <input
              id="lc-gap"
              type="text"
              value={gap}
              onChange={(e) => setGap(e.target.value)}
              placeholder="Find her on LinkedIn"
            />
            <span className="hint">
              Kept as a stated gap rather than a blank, the same way the scanners record one.
            </span>
          </p>
        </fieldset>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="btn btn-ok" type="submit" disabled={busy || !summary.trim()}>
            {busy ? "Saving…" : "Log it"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
