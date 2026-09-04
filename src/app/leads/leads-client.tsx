"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LeadCard from "@/components/lead-card";
import { AGENT_LABEL, FIT_ORDER, type LeadStatus, type LeadView } from "@/lib/leads";
import type { OrganisationOption } from "@/lib/organisations";

type StatusFilter = "Open" | "Approved" | "Rejected" | "All";

export default function LeadsClient({
  initialLeads,
  organisations,
  canDecide,
  region,
}: {
  initialLeads: LeadView[];
  organisations: OrganisationOption[];
  canDecide: boolean;
  region: "UK" | "Dubai";
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [agent, setAgent] = useState("All");
  const [fit, setFit] = useState("All");
  const [status, setStatus] = useState<StatusFilter>("Open");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const agents = useMemo(
    () => Array.from(new Set(leads.map((l) => l.agent))).sort(),
    [leads],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (agent !== "All" && l.agent !== agent) return false;
        if (fit !== "All" && l.fit !== fit) return false;
        if (status === "Open" && l.status !== "New") return false;
        if (status === "Approved" && l.status !== "Approved") return false;
        if (status === "Rejected" && l.status !== "Rejected") return false;
        if (needle) {
          const hay = [l.title, l.what, l.whereText, l.contact, l.role, l.entity]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const d = FIT_ORDER[a.fit] - FIT_ORDER[b.fit];
        return d !== 0 ? d : a.title.localeCompare(b.title);
      });
  }, [leads, agent, fit, status, q]);

  const count = (fn: (l: LeadView) => boolean) => leads.filter(fn).length;
  const open = count((l) => l.status === "New");
  const approved = count((l) => l.status === "Approved");
  const highOpen = count((l) => l.fit === "High" && l.status === "New");

  async function decide(id: string, next: LeadStatus) {
    setBusyId(id);
    setError(null);
    const before = leads;
    /* optimistic */
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: next } : l)));
    try {
      const res = await fetch(`/api/leads/${id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server said ${res.status}`);
      }
      const body = await res.json();
      startTransition(() =>
        setLeads((prev) =>
          prev.map((l) =>
            l.id === id
              ? { ...l, status: body.lead?.status ?? next, statusChangedAt: new Date().toISOString() }
              : l,
          ),
        ),
      );
    } catch (e) {
      setLeads(before);
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  const chip = (
    group: string,
    value: string,
    label: string,
    on: boolean,
    onClick: () => void,
    n?: number,
  ) => (
    <button
      key={group + value}
      className="chip"
      type="button"
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
      {n === undefined ? null : <span className="c">{n}</span>}
    </button>
  );

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="n">{leads.length}</div>
          <div className="l">Leads found</div>
        </div>
        <div className="stat flag">
          <div className="n">{highOpen}</div>
          <div className="l">High fit, unreviewed</div>
        </div>
        <div className="stat">
          <div className="n">{open}</div>
          <div className="l">Awaiting review</div>
        </div>
        <div className="stat">
          <div className="n">{approved}</div>
          <div className="l">Approved</div>
        </div>
      </div>

      <div className="controls">
        <div className="row">
          <span className="lbl">Scanner</span>
          {chip("agent", "All", "All", agent === "All", () => setAgent("All"), leads.length)}
          {agents.map((a) =>
            chip(
              "agent",
              a,
              AGENT_LABEL[a] ?? a,
              agent === a,
              () => setAgent(a),
              count((l) => l.agent === a),
            ),
          )}
        </div>
        <div className="row">
          <span className="lbl">Fit</span>
          {["All", "High", "Medium", "Low"].map((f) =>
            chip("fit", f, f, fit === f, () => setFit(f)),
          )}
        </div>
        <div className="row">
          <span className="lbl">Status</span>
          {(
            [
              ["Open", "To review"],
              ["Approved", "Approved"],
              ["Rejected", "Rejected"],
              ["All", "Everything"],
            ] as const
          ).map(([value, label]) =>
            chip("status", value, label, status === value, () => setStatus(value)),
          )}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, contact, place…"
            aria-label="Search leads"
          />
        </div>
      </div>

      {error ? (
        <div className="error" role="alert">
          <strong>Could not save.</strong> {error}
        </div>
      ) : null}

      {leads.length === 0 ? (
        <div className="banner">
          <strong>No {region} leads in the database yet.</strong> Run{" "}
          <code>npm run import:leads</code> to load the existing JSON files, or point a scanner at{" "}
          <code>/api/leads/ingest</code>.
        </div>
      ) : null}

      <div className="list">
        {shown.length ? (
          shown.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              canDecide={canDecide}
              busy={busyId === l.id}
              onDecide={decide}
              organisations={organisations}
              /* Logging contact or setting a follow-up changes rows this page
                 read on the server, so re-read rather than guessing locally. */
              onChanged={() => router.refresh()}
            />
          ))
        ) : (
          <p className="empty">Nothing matches those filters.</p>
        )}
      </div>
    </>
  );
}
