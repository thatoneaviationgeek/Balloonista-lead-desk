import { auth, signOut } from "@/auth";

export default async function AppBar() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <div className="appbar">
      <div className="appbar-in">
        <span className="mark">Balloonista Control Panel</span>
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
