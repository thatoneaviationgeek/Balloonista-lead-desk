import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { createFollowUp } from "@/lib/pipeline-writes";

/* Set a reminder to come back to something. In-panel only: nothing here emails
   anyone, including staff. If a morning digest is ever added, AGENTS.md gets
   amended first — staff only, never a prospect, written down before it is
   built. */

export async function POST(request: Request) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await createFollowUp(gate.writer, body));
}
