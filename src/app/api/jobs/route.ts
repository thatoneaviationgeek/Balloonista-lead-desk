import { badRequest, readJson, requireWriter, respond } from "@/lib/api-auth";
import { createJob } from "@/lib/pipeline-writes";

/* Create a job by hand, for work that never touched the calendar. When the
   calendar sync lands it will create jobs too; this path stays, because some
   work is agreed on the phone and never becomes an event. */

export async function POST(request: Request) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  return respond(await createJob(gate.writer, body));
}
