import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { assignJob } from "@/lib/pipeline-writes";

/* Give a job to someone, or take it back by sending ownerId: null.
   A confirmed job with nobody on it is what the board exists to surface. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await assignJob(gate.writer, id, body));
}
