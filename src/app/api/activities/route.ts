import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { logActivity } from "@/lib/pipeline-writes";

/* Record that a person made contact. Nothing here sends anything to anyone —
   AGENTS.md stands. Aurelija emails whomever she likes from her own inbox; this
   writes down that she did.

   Auth, parse, call, respond. The logic — and everything worth testing — is in
   `logActivity`, which `src/scripts/check-pipeline.ts` exercises directly. */

export async function POST(request: Request) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await logActivity(gate.writer, body));
}
