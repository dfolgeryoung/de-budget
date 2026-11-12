import { useEffect, useState } from "react";

export function SignIn() {
  const error = new URLSearchParams(location.search).get("error");
  const [csrf, setCsrf] = useState<string | null>(null);
  useEffect(() => {
    // Auth.js needs its CSRF token (and the cookie that comes with it) on every sign-in POST.
    fetch("/api/auth/csrf")
      .then((r) => r.json())
      .then((d: { csrfToken?: string }) => setCsrf(d.csrfToken ?? null))
      .catch(() => setCsrf(null));
  }, []);
  return (
    <main className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl p-8 flex flex-col gap-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div>
          <div className="text-2xl font-bold">D&amp;E Budget</div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>One budget, two sign-ins.</div>
        </div>
        {error && (
          <div className="text-sm rounded-lg p-3" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>
            {error === "AccessDenied"
              ? "That Google account isn't on the list. Use the one you gave David."
              : error === "Configuration"
                ? "The app's sign-in settings are incomplete (AUTH_SECRET or the Google client)."
                : `Google sign-in failed (${error}).`}
          </div>
        )}
        <form method="post" action="/api/auth/signin/google">
          <input type="hidden" name="csrfToken" value={csrf ?? ""} />
          <input type="hidden" name="callbackUrl" value="/" />
          <button
            type="submit"
            disabled={!csrf}
            className="w-full rounded-lg py-3 font-semibold disabled:opacity-60"
            style={{ background: "var(--navy)", color: "var(--navy-text)" }}
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
