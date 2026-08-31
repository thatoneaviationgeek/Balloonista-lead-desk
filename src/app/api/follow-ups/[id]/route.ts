import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { updateFollowUp } from "@/lib/pipeline-writes";

/* Complete, cancel, reopen, reschedule — and, when completing, optionally set
   the next one in the same step. Completing takes a follow-up off the Due list
   without deleting it: the history of what was chased and when is the point, so
   nothing here removes a row. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await updateFollowUp(gate.writer, id, body));
}
