import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { setJobStatus } from "@/lib/pipeline-writes";

/* Move a job along: enquiry → quoted → confirmed → delivered → invoiced, or
   cancelled. Audited into job_events, and — once the calendar sync exists —
   never overwritten by it. The calendar owns the when and the title; the panel
   owns the status. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await setJobStatus(gate.writer, id, body));
}
