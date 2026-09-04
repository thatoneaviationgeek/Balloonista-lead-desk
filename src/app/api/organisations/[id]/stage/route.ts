import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { changeOrganisationStage } from "@/lib/pipeline-writes";

/* Move an organisation to a different stage — the dropdown Aurelija asked for.

   Every move is audited into `organisation_events`, and the body may carry a
   `next` to set the follow-up in the same step, atomically. Nothing here emails
   anyone: moving something to "contacted" records that she did, it does not do
   the contacting. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await changeOrganisationStage(gate.writer, id, body));
}
