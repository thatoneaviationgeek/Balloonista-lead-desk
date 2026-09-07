/**
 * The scanner ingest, as a function.
 *
 * Two callers share it: `POST /api/leads/ingest` (a scanner or a test posting
 * a batch directly) and `/api/cron/pull-ingest` (the drop-box puller, which is
 * how the scheduled tasks actually deliver — their runtime cannot POST). One
 * implementation, one set of rules, one harness.
 *
 * The rule that matters: facts are refreshed, decisions are never touched.
 * `status`, `statusChangedAt`, `statusChangedBy`, `organisationId` and `notes`
 * belong to a person and are absent from the upsert's `set` list on purpose.
 * `check-rerun-isolation.ts` fails if that ever changes.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, agentSettings, leads } from "@/db/schema";
import { dedupeKeyFor } from "./leads";

export type Region = "UK" | "Dubai";
export type Fit = "High" | "Medium" | "Low";

export type IncomingLead = {
  id?: string;
  agent?: string;
  title?: string;
  fit?: string;
  what?: string;
  where?: string;
  entity?: string;
  address?: string;
  contact?: string;
  role?: string;
  src?: string;
};

export type IngestBody = {
  region: Region;
  agent: string;
  leads: IncomingLead[];
  meta: Record<string, unknown> | null;
};

/** Where a batch came from. Recorded in `agent_runs.meta` so the runs view can
 *  tell a direct post from a pulled file. */
export type IngestOrigin =
  | { source: "http" }
  | { source: "drive"; fileId: string; fileName: string };

export type IngestResult = {
  runId: string;
  found: number;
  created: number;
  duplicate: number;
};

const FITS = new Set<string>(["High", "Medium", "Low"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validates a raw body into an `IngestBody`, or explains what is wrong with
 *  it. Deliberately lenient about lead fields — a scanner that omits `fit`
 *  gets Medium, as it always has — and strict only about the envelope. */
export function parseIngestBody(
  raw: unknown,
): { ok: true; body: IngestBody } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const region =
    raw.region === "Dubai" ? "Dubai" : raw.region === "UK" ? "UK" : null;
  if (!region || !Array.isArray(raw.leads)) {
    return { ok: false, error: "Body must be { region: 'UK' | 'Dubai', leads: [...] }" };
  }
  const items = raw.leads.filter(isRecord) as IncomingLead[];
  const firstAgent = items[0]?.agent;
  const agent =
    (typeof raw.agent === "string" && raw.agent.trim()) ||
    (typeof firstAgent === "string" && firstAgent.trim()) ||
    "unknown";
  const meta = isRecord(raw.meta) ? raw.meta : null;
  return { ok: true, body: { region, agent, leads: items, meta } };
}

/** True when a person has switched this agent off for this region. */
export async function agentPaused(agent: string, region: Region): Promise<boolean> {
  const [row] = await db
    .select({ paused: agentSettings.paused })
    .from(agentSettings)
    .where(and(eq(agentSettings.agent, agent), eq(agentSettings.region, region)))
    .limit(1);
  return row?.paused === true;
}

/** Thrown by `ingestBatch` when the agent is paused. Callers decide what that
 *  means for them: the route answers 409, the puller files the batch under
 *  `failed` with this message. */
export class AgentPausedError extends Error {
  constructor(agent: string, region: Region) {
    super(`paused: ${agent} (${region}) is switched off in agent_settings`);
    this.name = "AgentPausedError";
  }
}

/**
 * Records a run and upserts every lead in the batch. Refuses a paused agent
 * before writing anything. The run row is written first so a failure
 * mid-batch still leaves a `failed` run behind to look at.
 */
export async function ingestBatch(body: IngestBody, origin: IngestOrigin): Promise<IngestResult> {
  if (await agentPaused(body.agent, body.region)) {
    throw new AgentPausedError(body.agent, body.region);
  }

  const meta = { ...(body.meta ?? {}), ...origin };
  const [run] = await db
    .insert(agentRuns)
    .values({ agent: body.agent, region: body.region, status: "running", meta })
    .returning();

  let created = 0;
  let duplicate = 0;

  try {
    for (const raw of body.leads) {
      const title = (raw.title ?? "").trim();
      if (!title) continue;
      const dedupeKey = dedupeKeyFor({ id: raw.id, title, where: raw.where });
      const fit = FITS.has(raw.fit ?? "") ? (raw.fit as Fit) : "Medium";

      const before = (
        await db
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.region, body.region), eq(leads.dedupeKey, dedupeKey)))
          .limit(1)
      )[0];

      await db
        .insert(leads)
        .values({
          region: body.region,
          sourceId: raw.id ?? null,
          dedupeKey,
          agent: raw.agent ?? body.agent,
          title,
          fit,
          what: raw.what ?? "",
          whereText: raw.where ?? null,
          entity: raw.entity ?? null,
          address: raw.address ?? null,
          contact: raw.contact ?? null,
          role: raw.role ?? null,
          src: raw.src ?? null,
        })
        .onConflictDoUpdate({
          target: [leads.region, leads.dedupeKey],
          set: {
            /* Refresh the facts, never the decisions. Nothing that a person set
               by hand belongs in this list — not `status`, not `statusChangedAt`,
               not `notes`, and not `organisationId`, which looks like a fact
               about the lead but is a link she made herself. */
            agent: sql`excluded.agent`,
            title: sql`excluded.title`,
            fit: sql`excluded.fit`,
            what: sql`excluded.what`,
            whereText: sql`excluded.where_text`,
            entity: sql`excluded.entity`,
            address: sql`excluded.address`,
            contact: sql`excluded.contact`,
            role: sql`excluded.role`,
            src: sql`excluded.src`,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });

      if (before) duplicate++;
      else created++;
    }

    await db
      .update(agentRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        leadsFound: body.leads.length,
        leadsNew: created,
        leadsDuplicate: duplicate,
      })
      .where(eq(agentRuns.id, run.id));

    return { runId: run.id, found: body.leads.length, created, duplicate };
  } catch (error) {
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(agentRuns.id, run.id));
    throw error;
  }
}
