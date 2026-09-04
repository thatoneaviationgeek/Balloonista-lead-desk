"use client";

import { useState } from "react";
import Modal from "./modal";
import {
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  JOB_TYPES,
  JOB_TYPE_LABEL,
  type OwnerOption,
} from "@/lib/jobs";

/**
 * Add a job by hand.
 *
 * The calendar will create most jobs once it is connected, but not all work
 * starts as an event — plenty is agreed on the phone. This stays afterwards
 * rather than being scaffolding.
 *
 * Date and time are sent separately and turned into an instant on the server,
 * in London. Doing it in the browser would use the viewer's zone, which is
 * wrong the moment somebody opens this from Dubai.
 */
export default function NewJobDialog({
  owners,
  today,
  onClose,
  onCreated,
}: {
  owners: OwnerOption[];
  today: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [venue, setVenue] = useState("");
  const [type, setType] = useState<string>("install");
  const [status, setStatus] = useState<string>("enquiry");
  const [startsOn, setStartsOn] = useState(today);
  const [startsAtTime, setStartsAtTime] = useState("09:00");
  const [endsAtTime, setEndsAtTime] = useState("");
  const [value, setValue] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const pounds = value.trim().replace(/[£,\s]/g, "");
      if (pounds && !/^\d+(\.\d{1,2})?$/.test(pounds)) {
        throw new Error("Value should be a number of pounds, like 1500 or 1500.50");
      }
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          clientName: clientName.trim() || null,
          venue: venue.trim() || null,
          type,
          status,
          startsOn: startsOn || null,
          startsAtTime: startsAtTime || null,
          endsAtTime: endsAtTime || null,
          /* Pence, never a float — the column is an integer of minor units. */
          valuePence: pounds ? Math.round(Number(pounds) * 100) : null,
          ownerId: ownerId || null,
          notes: notes.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Server said ${res.status}`);
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a job"
      description="For work agreed outside the calendar. Nothing here contacts the client — it records what is booked."
      onClose={onClose}
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="fld">
          <label htmlFor="nj-title">What is it</label>
          <input
            id="nj-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Balloon arch and table displays"
            required
          />
        </p>

        <p className="fld">
          <label htmlFor="nj-client">Client — optional</label>
          <input id="nj-client" type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </p>

        <p className="fld">
          <label htmlFor="nj-venue">Venue — optional</label>
          <input id="nj-venue" type="text" value={venue} onChange={(e) => setVenue(e.target.value)} />
        </p>

        <div className="fld-row">
          <p className="fld">
            <label htmlFor="nj-date">Date</label>
            <input id="nj-date" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </p>
          <p className="fld">
            <label htmlFor="nj-start">Starts</label>
            <input id="nj-start" type="time" value={startsAtTime} onChange={(e) => setStartsAtTime(e.target.value)} />
          </p>
          <p className="fld">
            <label htmlFor="nj-end">Ends — optional</label>
            <input id="nj-end" type="time" value={endsAtTime} onChange={(e) => setEndsAtTime(e.target.value)} />
          </p>
        </div>

        <div className="fld-row">
          <p className="fld">
            <label htmlFor="nj-type">Type</label>
            <select id="nj-type" value={type} onChange={(e) => setType(e.target.value)}>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </p>
          <p className="fld">
            <label htmlFor="nj-status">Status</label>
            <select id="nj-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {JOB_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </p>
          <p className="fld">
            <label htmlFor="nj-owner">Who is doing it</label>
            <select id="nj-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Nobody yet</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ?? o.email}
                </option>
              ))}
            </select>
          </p>
        </div>

        <p className="fld">
          <label htmlFor="nj-value">Value in pounds — optional</label>
          <input
            id="nj-value"
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="1500"
          />
        </p>

        <p className="fld">
          <label htmlFor="nj-notes">Notes — optional</label>
          <input id="nj-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </p>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="btn btn-ok" type="submit" disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Add the job"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
