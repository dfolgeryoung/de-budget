import { Hono } from "hono";
import type { SessionUser } from "./auth.js";
import { handleAuth, getSessionUser } from "./auth.js";

type Env = { Variables: { user: SessionUser } };

export const app = new Hono<Env>().basePath("/api");

app.onError((err, c) => {
  console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: err.message }, 500);
});

app.get("/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

// Auth.js handles /api/auth/* (signin, callback, session, signout)
app.all("/auth/*", (c) => handleAuth(c.req.raw));

// Everything below needs a signed-in, allow-listed user
app.use("/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth") || c.req.path === "/api/health" || c.req.path.startsWith("/api/cron")) return next();
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "signed out" }, 401);
  c.set("user", user);
  await next();
});

app.get("/me", (c) => c.json(c.get("user")));

// Daily job (Vercel cron): recurring entries, pushes, sheet mirror, backups, Monday summary.
app.get("/cron/daily", async (c) => {
  const auth = c.req.header("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return c.text("forbidden", 403);
  // phase 5: create due recurring entries; phase 3: mirror; phase 6: summaries
  return c.json({ ok: true, ran: [] });
});

export type App = typeof app;
