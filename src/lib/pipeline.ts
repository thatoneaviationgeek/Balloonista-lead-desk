/** Shared shapes and helpers for the Phase 2A pipeline: organisations,
 *  contacts, activities, follow-ups and lead feedback. */

export const ACTIVITY_KINDS = [
  "email_sent",
  "email_received",
  "call",
  "meeting",
  "quote_sent",
  "note",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const FOLLOW_UP_STATUSES = ["open", "done", "cancelled"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FEEDBACK_VERDICTS = ["useful", "not_useful"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

export const FEEDBACK_REASONS = [
  "wrong_location",
  "wrong_sector",
  "too_small",
  "already_client",
  "bad_timing",
  "contact_unusable",
  "other",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** Labels for the UI. British English, sentence case. */
export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  email_sent: "Email sent",
  email_received: "Email received",
  call: "Call",
  meeting: "Meeting",
  quote_sent: "Quote sent",
  note: "Note",
};

export const FEEDBACK_REASON_LABEL: Record<FeedbackReason, string> = {
  wrong_location: "Wrong location",
  wrong_sector: "Wrong sector",
  too_small: "Too small",
  already_client: "Already a client",
  bad_timing: "Bad timing",
  contact_unusable: "Contact unusable",
  other: "Other",
};

/** Lower-case, alphanumeric, hyphen-separated. Same shape as `dedupeKeyFor`. */
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/**
 * Stable key for an organisation within a region. Her 57 rows will be imported
 * more than once before the mapping is right; without this a second run doubles
 * the list rather than matching what is already there.
 */
export function organisationDedupeKey(name: string) {
  return slugify(name) || "unnamed";
}

/**
 * Stable key for a contact within an organisation.
 *
 * Email first because one organisation often has several named people — her
 * spreadsheet has two at Fortnum's — so a name alone is the weaker key. Falls
 * back to the name when there is no address, which is common: plenty of her rows
 * record a person with only a stated gap where the email should be.
 */
export function contactDedupeKey(input: { email?: string | null; name?: string | null }) {
  const email = (input.email ?? "").trim().toLowerCase();
  if (email) return email.slice(0, 120);
  return slugify(input.name ?? "") || "unnamed";
}

/**
 * An email column holds a real address or nothing at all. Prose such as "Find
 * her on LinkedIn" belongs in `contacts.gap`, which is what keeps this column
 * trustworthy. Mirrors the `contacts_email_shape` CHECK so the API can refuse it
 * with a useful message rather than surfacing a constraint violation.
 */
export function looksLikeEmail(value: string) {
  return value.includes("@");
}

/**
 * What Log contact and Set follow-up are being written against.
 *
 * The write paths already take a leadId or an organisationId, so pointing the
 * dialogs at an organisation is a matter of saying which — not new logic. Only
 * a lead can carry the approval question, because only a lead has a status to
 * approve.
 */
export type WriteSubject =
  | {
      kind: "lead";
      id: string;
      title: string;
      region: "UK" | "Dubai";
      /* Set when the lead has already been attached to an account. */
      organisationId: string | null;
    }
  | { kind: "organisation"; id: string; title: string };

/** The links to send for a subject. */
export function subjectLinks(subject: WriteSubject) {
  return subject.kind === "lead"
    ? { leadId: subject.id, ...(subject.organisationId ? { organisationId: subject.organisationId } : {}) }
    : { organisationId: subject.id };
}

export const ORG_RELATIONSHIP_LABEL: Record<string, string> = {
  direct_client: "Direct client",
  venue_partner: "Venue partner",
  referral_partner: "Referral partner",
  agency_partner: "Agency partner",
};

export const ORG_CONTACT_STATUS_LABEL: Record<string, string> = {
  not_contacted: "Not contacted",
  initial_email_sent: "Emailed",
  have_a_contact: "Have a contact",
};
