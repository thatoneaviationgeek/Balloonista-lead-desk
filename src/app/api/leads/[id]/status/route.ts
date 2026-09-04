import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { setLeadStatus } from "@/lib/pipeline-writes";

/* Approve, reject or un-review a lead, and optionally say which organisation it
   belongs to in the same call.

   Approving links the lead to an account rather than converting it into one —
   the gala is a moment, the charity is the relationship. Both writes go in one
   batch so a lead cannot end up approved but unattached. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await setLeadStatus(gate.writer, id, body));
}
