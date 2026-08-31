import { redirect } from "next/navigation";
import AppBar from "@/components/app-bar";
import DueClient from "./due-client";
import { auth } from "@/auth";
import { listDue } from "@/lib/due";

export const dynamic = "force-dynamic";

export default async function DuePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  /* Defence in depth: the proxy should never let an anonymous request reach
     here, but this page must not serve her follow-ups on the assumption that
     it ran. */
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/due");

  const { scope: raw } = await searchParams;
  const scope = raw === "all" ? "all" : "mine";
  const due = await listDue(session.user.id, scope);

  return (
    <>
      <AppBar current="due" />
      <div className="wrap">
        <header className="top">
          <nav className="regionnav" aria-label="Whose follow-ups">
            <a href="/due?scope=mine" aria-current={scope === "mine" ? "page" : undefined}>
              Mine
            </a>
            <a href="/due?scope=all" aria-current={scope === "all" ? "page" : undefined}>
              Everyone
            </a>
          </nav>
          <h1 className="brand">Due</h1>
          <p className="sub">
            What needs chasing, and what has slipped. Completing something offers to set the
            next one, because the loop is usually chase, no answer, chase again.
          </p>
          <div className="meta">
            <span>
              {due.total === 0
                ? "Nothing open"
                : due.total === 1
                  ? "1 follow-up open"
                  : `${due.total} follow-ups open`}
            </span>
            <span>{scope === "mine" ? "Assigned to you" : "Everyone"}</span>
            <span>
              Today is{" "}
              {new Date(due.today + "T12:00:00Z").toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              })}
            </span>
          </div>
        </header>

        <DueClient initial={due} scope={scope} />

        <footer>
          <p>
            Follow-ups are reminders inside this panel. Nothing here emails anyone, including
            staff — completing one records that it was dealt with, and nothing leaves the
            building. Completed follow-ups are kept rather than deleted, so the history of what
            was chased and when survives.
          </p>
        </footer>
      </div>
    </>
  );
}
