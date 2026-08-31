import { auth, signOut } from "@/auth";
import { countOverdueForPerson } from "@/lib/due";

export default async function AppBar({ current }: { current?: "leads" | "due" }) {
  const session = await auth();
  if (!session?.user) return null;

  /* Hers, not everyone's. The point of putting it here is that a slipped
     follow-up is visible from the leads page without going looking for it. */
  const overdue = await countOverdueForPerson(session.user.id);

  return (
    <div className="appbar">
      <div className="appbar-in">
        <span className="mark">Balloonista Control Panel</span>

        <nav className="abnav" aria-label="Sections">
          <a href="/leads" aria-current={current === "leads" ? "page" : undefined}>
            Leads
          </a>
          <a href="/due" aria-current={current === "due" ? "page" : undefined}>
            Due
            {overdue > 0 ? (
              <span className="ab-badge">
                {overdue}
                <span className="sr-only"> overdue</span>
              </span>
            ) : null}
          </a>
        </nav>

        <span className="who">
          <span>{session.user.email}</span>
          <span className="role">{session.user.role}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        </span>
      </div>
    </div>
  );
}
