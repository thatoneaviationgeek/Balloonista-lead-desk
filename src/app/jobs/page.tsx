import { redirect } from "next/navigation";
import AppBar from "@/components/app-bar";
import JobsClient from "./jobs-client";
import { auth } from "@/auth";
import { todayInLondon } from "@/lib/dates";
import { listJobs, listOwnerOptions } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/jobs");

  const [jobs, owners] = await Promise.all([listJobs(), listOwnerOptions()]);

  return (
    <>
      <AppBar current="jobs" />
      <div className="wrap">
        <header className="top">
          <h1 className="brand">Jobs</h1>
          <p className="sub">
            What is booked, and what still has nobody on it. Google Calendar stays the diary —
            this is the layer around it that answers what a diary cannot: which confirmed work
            is unresourced, what it is worth, and which enquiry it came from.
          </p>
          <div className="meta">
            <span>
              {jobs.length === 1 ? "1 job on file" : `${jobs.length} jobs on file`}
            </span>
            <span>Times shown in London</span>
            <span>
              {session.user.role === "viewer" ? "View only" : "Add and assign jobs here"}
            </span>
          </div>
        </header>

        <JobsClient
          jobs={jobs}
          owners={owners}
          canWrite={session.user.role === "owner" || session.user.role === "staff"}
          today={todayInLondon()}
        />

        <footer>
          <p>
            Jobs added here are records, not messages — nothing on this screen contacts a client.
            When the calendar sync is connected it will create and update jobs from Google, and
            it will never overwrite a status, an owner or a value set here: the calendar owns the
            when and the title, the panel owns the decisions.
          </p>
        </footer>
      </div>
    </>
  );
}
