"use client";

import { useMemo, useState } from "react";
import Modal from "./modal";
import type { LeadView } from "@/lib/leads";
import type { OrganisationOption } from "@/lib/organisations";

/**
 * Approving a lead, and saying which account it belongs to.
 *
 * Aurelija asked whether approving moves a lead into the organisations section.
 * It links rather than converts — the gala is a moment, the charity behind it is
 * the account, and next year's gala is a second moment against the same account.
 * She still sees it move, because the lead desk hides reviewed leads by default.
 *
 * The search starts pre-filled with what the lead already knows, so the likely
 * match is usually on screen before she types anything. Fifty-seven accounts
 * filter instantly in the browser; there is no search endpoint to authorise.
 */
export default function ApproveLeadDialog({
  lead,
  organisations,
  onClose,
  onApproved,
}: {
  lead: LeadView;
  organisations: OrganisationOption[];
  onClose: () => void;
  onApproved: () => void;
}) {
  /* The hiring entity names the company; the title names the occasion. Prefer
     the entity, fall back to the title. */
  const seed = (lead.entity && lead.entity !== "—" ? lead.entity : lead.title).trim();

  const [q, setQ] = useState(seed);
  const [newName, setNewName] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return organisations.slice(0, 8);
    const words = needle.split(/\s+/).filter((w) => w.length > 2);
    return organisations
      .map((o) => {
        const name = o.name.toLowerCase();
        /* A whole-string hit beats a word hit, which beats nothing. */
        let score = 0;
        if (name.includes(needle)) score += 10;
        for (const w of words) if (name.includes(w)) score += 2;
        return { o, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.o.name.localeCompare(b.o.name))
      .slice(0, 8)
      .map((m) => m.o);
  }, [organisations, q]);

  async function approve(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "Approved", ...payload }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || `Server said ${res.status}`);
      }
      onApproved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Approve — which account is this?"
      description={`“${lead.title}” becomes approved and joins that account under Organisations. The lead stays as the occasion; the account is the relationship behind it.`}
      onClose={onClose}
    >
      <div className="fields">
        <p className="fld">
          <label htmlFor="ap-q">Search your accounts</label>
          <input
            id="ap-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name of the company or venue"
          />
          <span className="hint">
            Pre-filled from the lead. {organisations.length} accounts on file.
          </span>
        </p>

        {matches.length ? (
          <div className="ap-matches" role="group" aria-label="Matching accounts">
            {matches.map((o) => (
              <button
                key={o.id}
                className="ap-match"
                type="button"
                disabled={busy}
                onClick={() => approve({ organisationId: o.id })}
              >
                <span className="ap-match-name">{o.name}</span>
                <span className="ap-match-meta">
                  {[o.sector, o.region].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">No account matches that. Create one below.</p>
        )}

        <fieldset className="sub-fields">
          <legend>Or create a new account</legend>
          <p className="fld">
            <label htmlFor="ap-new">Name</label>
            <input
              id="ap-new"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <span className="hint">
              Starts at <strong>Not contacted</strong>, in {lead.region}. Add the person with Log
              contact once you know who to speak to.
            </span>
          </p>
          <div className="modal-actions">
            <button
              className="btn"
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => approve({ newOrganisation: { name: newName.trim() } })}
            >
              Create and approve
            </button>
          </div>
        </fieldset>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="btn btn-ok" type="button" disabled={busy} onClick={() => approve({})}>
            Approve without linking
          </button>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
