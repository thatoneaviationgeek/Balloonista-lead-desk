import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { recordFeedback } from "@/lib/pipeline-writes";

/* Her verdict on whether a scanner lead was worth having.
   Not useful has to say why, because free text alone drifts to "no" and "not
   right", which cannot be aggregated into anything a scanner prompt can use.
   Useful asks for nothing. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await recordFeedback(gate.writer, id, body));
}
