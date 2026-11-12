import { Auth, type AuthConfig } from "@auth/core";
import Google from "@auth/core/providers/google";

const allowed = () =>
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const authConfig: AuthConfig = {
  basePath: "/api/auth",
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 }, // 90 days; re-sign-in is rare
  providers: [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })],
  callbacks: {
    // Only the two of you can get in, whatever Google account is used.
    signIn: ({ user }) => allowed().includes((user.email ?? "").toLowerCase()),
    jwt: ({ token, profile }) => {
      if (profile?.sub) token.sub = profile.sub;
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  pages: { signIn: "/signin", error: "/signin" },
};

/**
 * Behind Vercel's proxy the function sees http://host/...; the real scheme and host arrive in
 * X-Forwarded-Proto / X-Forwarded-Host. Auth.js builds redirect URIs from the request URL, so fix it first.
 */
export function externalRequest(req: Request): Request {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host");
  if (proto) url.protocol = `${proto.split(",")[0]!.trim()}:`;
  if (host) url.host = host.split(",")[0]!.trim();
  if (url.href === req.url) return req;
  return new Request(url, req);
}

export const handleAuth = (req: Request) => Auth(externalRequest(req), authConfig);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Read the session from the request cookies; null when signed out. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const url = new URL(externalRequest(req).url);
  const sessionReq = new Request(`${url.origin}/api/auth/session`, { headers: req.headers });
  const res = await Auth(sessionReq, authConfig);
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: { id?: string; email?: string; name?: string } } | null;
  if (!data?.user?.id || !data.user.email) return null;
  return { id: data.user.id, email: data.user.email, name: data.user.name ?? data.user.email };
}
