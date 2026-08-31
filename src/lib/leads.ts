/** Shared shapes and helpers for lead data. */
import type { ActivityKind, FeedbackReason, FeedbackVerdict } from "./pipeline";

export const AGENT_LABEL: Record<string, string> = {
  Film: "Film & TV",
  Retail: "Retail",
  Events: "Events",
  Channel: "Channel",
};

export const FIT_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export type LeadStatus = "New" | "Approved" | "Rejected";

/** One thing a person did about this lead, newest first in the card history. */
export type LeadActivity = {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  summary: string;
  actorEmail: string | null;
  contactName: string | null;
  organisationName: string | null;
};

/** The soonest open follow-up, if there is one. Drives the chip on the card. */
export type LeadFollowUp = {
  id: string;
  dueAt: string;
  note: string | null;
};

/** This person's verdict on this lead. One row per lead per person. */
export type LeadFeedbackView = {
  verdict: FeedbackVerdict;
  reason: FeedbackReason | null;
  note: string | null;
};

export type LeadView = {
  id: string;
  region: "UK" | "Dubai";
  agent: string;
  title: string;
  fit: "High" | "Medium" | "Low";
  what: string;
  whereText: string | null;
  entity: string | null;
  address: string | null;
  contact: string | null;
  role: string | null;
  src: string | null;
  status: LeadStatus;
  statusChangedAt: string | null;
  notes: string | null;
  organisationId: string | null;
  activities: LeadActivity[];
  followUp: LeadFollowUp | null;
  feedback: LeadFeedbackView | null;
};

/** Stable de-duplication key. Prefers the scanner's own id. */
export function dedupeKeyFor(input: { id?: string | null; title: string; where?: string | null }) {
  if (input.id && input.id.trim()) return input.id.trim().toLowerCase();
  return (
    (input.title + "|" + (input.where ?? ""))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "untitled"
  );
}

export function isGap(contact: string | null | undefined) {
  return /^GAP/.test((contact ?? "").trim());
}
