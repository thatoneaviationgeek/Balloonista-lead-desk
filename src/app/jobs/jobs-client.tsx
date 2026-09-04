"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JobCard from "@/components/job-card";
import NewJobDialog from "@/components/new-job-dialog";
import { addDays, weekLabel, weekOf } from "@/lib/dates";
import {
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  type JobStatus,
  type JobView,
  type OwnerOption,
} from "@/lib/jobs";

type View = "week" | "month" | "all";

export default function JobsClient({
  jobs,
  owners,
  canWrite,
  today,
}: {
  jobs: JobView[];
  owners: OwnerOption[];
  canWrite: boolean;
  /** Today in London, computed on the server so the client's clock cannot
      disagree about which week "this week" is. */
  today: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("week");
  /* Which week is on screen, as the Monday. Moving through weeks is date-string
     arithmetic — no Date object, no zone. */
  const [weekStart, setWeekStart] = useState(() => weekOf(today).from);
  const [status, setStatus] = useState<JobStatus | "All" | "Open">("Open");
  const [dialog, setDialog] = useState(false);

  const weekEnd = addDays(weekStart, 6);
  const monthPrefix = weekStart.slice(0, 7);

  const shown = useMemo(() => {
    return jobs.filter((j) => {
      if (status === "Open" && (j.status === "cancelled" || j.status === "invoiced")) return false;
      if (status !== "All" && status !== "Open" && j.status !== status) return false;

      if (view === "all") return true;
      /* An undated job belongs to no week and no month. It is not lost — the
         "No date yet" tile counts it and Everything shows it. */
      if (!j.startsOn) return false;
      if (view === "week") return j.startsOn >= weekStart && j.startsOn <= weekEnd;
      return j.startsOn.slice(0, 7) === monthPrefix;
    });
  }, [jobs, status, view, weekStart, weekEnd, monthPrefix]);

  /* Undated jobs would silently vanish from a week view, which is how work gets
     forgotten. Counted so they are at least visible as a number. */
  const undated = jobs.filter((j) => !j.startsOn).length;
  const unresourced = jobs.filter((j) => j.unresourced).length;

  const chip = (label: string, on: boolean, onClick: () => void, n?: number) => (
    <button key={label} className="chip" type="button" aria-pressed={on} onClick={onClick}>
      {label}
      {n === undefined ? null : <span className="c">{n}</span>}
    </button>
  );

  const byDay = useMemo(() => {
    const map = new Map<string, JobView[]>();
    for (const j of shown) {
      const key = j.startsOn ?? "undated";
      const list = map.get(key) ?? [];
      list.push(j);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) =>
      a[0] === "undated" ? 1 : b[0] === "undated" ? -1 : a[0].localeCompare(b[0]),
    );
  }, [shown]);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="n">{jobs.length}</div>
          <div className="l">Jobs on file</div>
        </div>
        <div className="stat flag">
          <div className="n">{unresourced}</div>
          <div className="l">Confirmed, nobody assigned</div>
        </div>
        <div className="stat">
          <div className="n">{shown.length}</div>
          <div className="l">In this view</div>
        </div>
        <div className="stat">
          <div className="n">{undated}</div>
          <div className="l">No date yet</div>
        </div>
      </div>

      <div className="controls">
        <div className="row">
          <span className="lbl">Showing</span>
          {chip("This week", view === "week", () => {
            setView("week");
            setWeekStart(weekOf(today).from);
          })}
          {chip("Month", view === "month", () => setView("month"))}
          {chip("Everything", view === "all", () => setView("all"), jobs.length)}

          {view === "week" ? (
            <span className="weeknav">
              <button
                className="btn"
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                ← Previous
              </button>
              <strong className="weeknav-label">{weekLabel(weekStart, weekEnd)}</strong>
              <button
                className="btn"
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                Next →
              </button>
            </span>
          ) : null}
        </div>

        <div className="row">
          <span className="lbl">Status</span>
          {chip("Live", status === "Open", () => setStatus("Open"))}
          {JOB_STATUSES.map((s) =>
            chip(
              JOB_STATUS_LABEL[s],
              status === s,
              () => setStatus(s),
              jobs.filter((j) => j.status === s).length,
            ),
          )}
          {chip("All", status === "All", () => setStatus("All"))}
          {canWrite ? (
            <button className="btn btn-ok" type="button" onClick={() => setDialog(true)}>
              Add a job
            </button>
          ) : null}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="due-clear">
          <p className="due-clear-line">No jobs yet.</p>
          <p className="due-clear-sub">
            Booked work will appear here once the calendar is connected. Until then, add anything
            agreed on the phone with <strong>Add a job</strong> — work that never touches the
            calendar belongs here too.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="due-clear">
          <p className="due-clear-line">Nothing on.</p>
          <p className="due-clear-sub">
            No jobs match this view.
            {undated > 0
              ? ` ${undated} job${undated === 1 ? " has" : "s have"} no date yet — try Everything.`
              : ""}
          </p>
        </div>
      ) : (
        byDay.map(([day, list]) => (
          <section className="job-day" key={day} aria-labelledby={`d-${day}`}>
            <h2 className="due-head" id={`d-${day}`}>
              {day === "undated"
                ? "No date yet"
                : new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
              <span className="due-count">{list.length}</span>
            </h2>
            <div className="list">
              {list.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  owners={owners}
                  canWrite={canWrite}
                  onChanged={() => router.refresh()}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {dialog ? (
        <NewJobDialog
          owners={owners}
          today={today}
          onClose={() => setDialog(false)}
          onCreated={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
