"use client";

import { useState } from "react";
import Modal from "./modal";
import { addDays, todayInLondon } from "@/lib/dates";
import { subjectLinks, type WriteSubject } from "@/lib/pipeline";

const SHORTCUTS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
] as const;

/**
 * Set a reminder to come back to this. In-panel only — nothing is emailed to
 * anyone, including staff.
 *
 * The shortcuts fill the date field rather than replacing it: she can always see
 * and change the date they chose, which is what keeps them a convenience rather
 * than three opaque buttons.
 */
export default function FollowUpDialog({
  subject,
  onClose,
  onSet,
}: {
  subject: WriteSubject;
  onClose: () => void;
  onSet: (followUp: { id: string; dueAt: string; note: string | null }) => void;
}) {
  const today = todayInLondon();
  const [dueAt, setDueAt] = useState(addDays(today, 7));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dueAt,
          note: note.trim() || null,
          ...subjectLinks(subject),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Server said ${res.status}`);
      onSet({ id: payload.id, dueAt, note: note.trim() || null });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Set a follow-up"
      description={`Against “${subject.title}”. It will appear in Due, and nothing is sent to anyone.`}
      onClose={onClose}
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="fld">
          <span className="fld-label" id="fu-shortcut-label">
            When
          </span>
          <div className="shortcuts" role="group" aria-labelledby="fu-shortcut-label">
            {SHORTCUTS.map((s) => {
              const value = addDays(today, s.days);
              return (
                <button
                  key={s.days}
                  className="chip"
                  type="button"
                  aria-pressed={dueAt === value}
                  onClick={() => setDueAt(value)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="fld">
          <label htmlFor="fu-date">Date</label>
          <input
            id="fu-date"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            required
          />
        </p>

        <p className="fld">
          <label htmlFor="fu-note">Note — optional</label>
          <input
            id="fu-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Chase if no reply"
          />
        </p>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="btn btn-ok" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Set follow-up"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
