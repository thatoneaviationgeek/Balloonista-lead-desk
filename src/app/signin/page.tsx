import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <main className="signin-shell">
      <div className="signin-card">
        <h1>Balloonista Control Panel</h1>
        <p>Sign in with your Balloonista Google account.</p>

        {error ? (
          <div className="error" style={{ marginBottom: 20, marginTop: 0, textAlign: "left" }}>
            {error === "AccessDenied"
              ? "That account is not on the list. Ask Jimmo or Aurelija to add you."
              : "Sign-in did not complete. Try again."}
          </div>
        ) : null}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl || "/leads" });
          }}
        >
          <button className="signin-btn" type="submit">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
