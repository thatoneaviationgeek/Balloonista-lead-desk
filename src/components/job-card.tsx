"use client";

import { useState } from "react";
import {
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  type JobStatus,
  type JobView,
  type OwnerOption,
} from "@/lib/jobs";

function money(pence: number | null) {
  if (pence === null) return null;
  return "£" + Math.round(pence / 100).toLocaleString("en-GB");
}

function humanDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function JobCard({
  job,
  owners,
  canWrite,
  onChanged,
}: {
  job: JobView;
  owners: OwnerOption[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || `Server said ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const value = money(job.valuePence);
  const when = job.startsOn
    ? humanDate(job.startsOn) +
      (job.startsAtTime && job.startsAtTime !== "00:00"
        ? ` · ${job.startsAtTime}${job.endsAtTime && job.endsAtTime !== job.startsAtTime ? `–${job.endsAtTime}` : ""}`
        : "")
    : "No date yet";

  return (
    <article
      className={
        "card job-card" +
        (job.unresourced ? " is-unresourced" : "") +
        (job.status === "cancelled" ? " done" : "") +
        (busy ? " busy" : "")
      }
    >
      <div className="card-top">
        <h3>{job.title}</h3>
        <span className="tag t-agent">{JOB_TYPE_LABEL[job.type]}</span>
        <span className={"tag t-job-" + job.status}>{JOB_STATUS_LABEL[job.status]}</span>
        {/* The flag the board exists for: confirmed, dated, nobody going. */}
        {job.unresourced ? <span className="tag t-rejected">Nobody assigned</span> : null}
      </div>

      <p className="job-when">{when}</p>

      <dl className="d">
        {job.clientName ? (
          <>
            <dt>Client</dt>
            <dd>{job.clientName}</dd>
          </>
        ) : null}
        {job.venue ? (
          <>
            <dt>Venue</dt>
            <dd>{job.venue}</dd>
          </>
        ) : null}
        {value ? (
          <>
            <dt>Value</dt>
            <dd>{value}</dd>
          </>
        ) : null}
        {job.leadId ? (
          <>
            <dt>Came from</dt>
            <dd>
              <a href={`/leads?focus=${job.leadId}`}>{job.leadTitle ?? "a lead"}</a>
            </dd>
          </>
        ) : null}
        {job.taskCount ? (
          <>
            <dt>Tasks</dt>
            <dd>
              {job.openTaskCount} of {job.taskCount} still to do
            </dd>
          </>
        ) : null}
      </dl>

      {job.notes ? <p className="what">{job.notes}</p> : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {canWrite ? (
        <div className="actions">
          <label className="stage-pick">
            <span className="stage-pick-label">Status</span>
            <select
              value={job.status}
              disabled={busy}
              onChange={(e) =>
                post(`/api/jobs/${job.id}/status`, { status: e.target.value as JobStatus })
              }
            >
              {JOB_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {JOB_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>

          <label className="stage-pick">
            <span className="stage-pick-label">Who</span>
            <select
              value={job.ownerId ?? ""}
              disabled={busy}
              onChange={(e) =>
                post(`/api/jobs/${job.id}/owner`, { ownerId: e.target.value || null })
              }
            >
              <option value="">Nobody yet</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ?? o.email}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="job-owner">{job.ownerEmail ? `Assigned to ${job.ownerEmail}` : "Nobody assigned"}</p>
      )}
    </article>
  );
}
