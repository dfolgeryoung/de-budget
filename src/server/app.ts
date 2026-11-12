import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SessionUser } from "./auth.js";
import { handleAuth, getSessionUser } from "./auth.js";
import { db } from "../db/client.js";
import * as t from "../db/schema.js";
import { importSheetExport } from "./importer.js";
import { monthPayload } from "./month.js";

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

app.get("/me", async (c) => {
  const u = c.get("user");
  // first sign-in creates the user row; the initial (D/E) is set from the allow-list order
  const order = (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase());
  const initial = order.indexOf(u.email.toLowerCase()) === 1 ? "E" : "D";
  await db.insert(t.users).values({ id: u.id, email: u.email, displayName: u.name, initial }).onConflictDoNothing();
  const row = (await db.select().from(t.users).where(eq(t.users.id, u.id)))[0];
  return c.json({ ...u, initial: row?.initial ?? initial, appearance: row?.appearance ?? "system", showBars: row?.showBars ?? true });
});

// ---- phase 1: import from the spreadsheet export, read-only month view ----
app.post("/import/sheet", async (c) => {
  const text = await c.req.text();
  if (!text.includes("## Sheet name: Ledger")) return c.json({ error: "That doesn't look like the budget's text export." }, 400);
  const summary = await importSheetExport(db, text, c.get("user").id);
  return c.json(summary);
});

const today = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // America/New_York, good enough until proper tz handling

app.get("/month/:key", async (c) => {
  const key = c.req.param("key");
  if (!/^\d{4}-\d{2}-01$/.test(key)) return c.json({ error: "month must be YYYY-MM-01" }, 400);
  return c.json(await monthPayload(db, key, today()));
});
app.get("/month", async (c) => c.json(await monthPayload(db, today().slice(0, 7) + "-01", today())));

// Daily job (Vercel cron): recurring entries, pushes, sheet mirror, backups, Monday summary.
app.get("/cron/daily", async (c) => {
  const auth = c.req.header("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return c.text("forbidden", 403);
  // phase 5: create due recurring entries; phase 3: mirror; phase 6: summaries
  return c.json({ ok: true, ran: [] });
});

export type App = typeof app;
