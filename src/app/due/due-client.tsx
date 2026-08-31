"use client";

import { useRef, useState } from "react";
import { addDays } from "@/lib/dates";
import type { DueItem, DueList } from "@/lib/due";

/* Noon UTC is the same calendar day in London all year, so this formats a
   date-only string without the zone ever shifting it. Never build a Date from a
   bare "YYYY-MM-DD" and trust local time — see src/lib/dates.ts. */
function human(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function daysBetween(from: string, to: string) {
  const a = Date.parse(from + "T12:00:00Z");
  const b = Date.parse(to + "T12:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

function lateness(dueAt: string, today: string) {
  const n = daysBetween(dueAt, today);
  if (n === 1) return "1 day late";
  return `${n} days late`;
}

/* Offered, never imposed. Her loop is chase, no answer, chase again — so
   completing something asks about the next one rather than silently emptying
   the list and leaving her to remember. "Done for now" is a first-class answer. */
const NEXT_OPTIONS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
] as const;

export default function DueClient({ initial, scope }: { initial: DueList; scope: "mine" | "all" }) {
  const [items, setItems] = useState<DueItem[]>([
    ...initial.overdue,
    ...initial.next7,
    ...initial.later,
  ]);
  const [offering, setOffering] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = initial.today;
  /* Completing a follow-up unmounts its row, which would drop focus to <body>
     and lose a keyboard user's place entirely. Park it on the group heading
     instead — the nearest thing that is still on screen and describes where
     they are. */
  const headings = useRef<Record<string, HTMLHeadingElement | null>>({});
  const lastBucket = useRef<string>("overdue");

  async function send(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const before = items;
    setItems((prev) => prev.filter((i) => i.id !== id)); /* optimistic */
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Server said ${res.status}`);
      }
      setOffering(null);
      headings.current[lastBucket.current]?.focus();
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  const buckets = [
    { key: "overdue", title: "Overdue", items: items.filter((i) => i.dueAt < today) },
    {
      key: "next7",
      title: "Next 7 days",
      items: items.filter((i) => i.dueAt >= today && i.dueAt <= addDays(today, 7)),
    },
    { key: "later", title: "Later", items: items.filter((i) => i.dueAt > addDays(today, 7)) },
  ];

  if (items.length === 0) {
    /* Calm, not broken. This is the screen she opens every morning, and on a
       good morning it is empty — that should read as being on top of things. */
    return (
      <div className="due-clear">
        <p className="due-clear-line">Nothing due.</p>
        <p className="due-clear-sub">
          {scope === "mine"
            ? "Nothing is waiting on you. Set a follow-up from a lead when you next make contact."
            : "Nobody has anything outstanding."}
        </p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {buckets.map((bucket) =>
        bucket.items.length === 0 ? null : (
          <section key={bucket.key} className="due-group" aria-labelledby={`h-${bucket.key}`}>
            <h2
              id={`h-${bucket.key}`}
              className="due-head"
              tabIndex={-1}
              ref={(el) => {
                headings.current[bucket.key] = el;
              }}
            >
              {bucket.title}
              <span className="due-count">{bucket.items.length}</span>
            </h2>

            <ul className="due-list">
              {bucket.items.map((item) => (
                <li
                  key={item.id}
                  className={
                    "due-item" +
                    (bucket.key === "overdue" ? " is-overdue" : "") +
                    (busyId === item.id ? " busy" : "")
                  }
                >
                  <div className="due-main">
                    <p className="due-subject">
                      {item.leadId ? (
                        <a href={`/leads?focus=${item.leadId}`}>{item.subject}</a>
                      ) : (
                        item.subject
                      )}
                    </p>
                    {item.context ? <p className="due-context">{item.context}</p> : null}
                    {item.note ? <p className="due-note">{item.note}</p> : null}
                    <p className="due-when">
                      <span className={bucket.key === "overdue" ? "tag t-rejected" : "tag t-low"}>
                        {human(item.dueAt)}
                      </span>
                      {bucket.key === "overdue" ? (
                        <span className="due-late">{lateness(item.dueAt, today)}</span>
                      ) : null}
                      {scope === "all" && !item.mine && item.assigneeEmail ? (
                        <span className="due-who">{item.assigneeEmail}</span>
                      ) : null}
                    </p>
                  </div>

                  {offering === item.id ? (
                    <div className="due-next" role="group" aria-label="Set the next follow-up">
                      <span className="due-next-ask">Set the next one?</span>
                      {NEXT_OPTIONS.map((opt, i) => (
                        <button
                          key={opt.days}
                          className="btn"
                          type="button"
                          autoFocus={i === 0}
                          disabled={busyId === item.id}
                          onClick={() => {
                            lastBucket.current = bucket.key;
                            send(item.id, {
                              status: "done",
                              next: { dueAt: addDays(today, opt.days), note: item.note },
                            });
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                      <button
                        className="btn"
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => {
                          lastBucket.current = bucket.key;
                          send(item.id, { status: "done" });
                        }}
                      >
                        Done for now
                      </button>
                    </div>
                  ) : (
                    <div className="actions">
                      <button
                        className="btn btn-ok"
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => setOffering(item.id)}
                      >
                        Done
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => {
                          lastBucket.current = bucket.key;
                          send(item.id, { status: "cancelled" });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </>
  );
}
