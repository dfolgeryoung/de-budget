import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { SessionUser } from "./auth.js";
import { handleAuth, getSessionUser } from "./auth.js";
import { db } from "../db/client.js";
import * as t from "../db/schema.js";
import { importSheetExport } from "./importer.js";
import { monthPayload } from "./month.js";
import { entrySchema, listTransactions, createTransaction, updateTransaction, deleteTransaction, findDuplicate, lists } from "./transactions.js";
import { move, typeAssigned, undoMove, recentMoves, autoAssign, categoryHistory } from "./assign.js";
import { classicPayload, saveClassicTyped } from "./classic.js";
import { reportsPayload } from "./reports.js";
import { trackedInput, listTracked, trackedEntries, createTracked, updateTracked, deleteTracked } from "./tracked.js";
import { mirrorToSheet, pickUpInbox, mirrorConfigured, sheetId } from "./mirror.js";
import { createDueRecurring, pending, confirmEntry, realignPending, skippedPending } from "./recurring.js";
import { nextDue, dueDatesInMonth } from "../budget/recurringDates.js";
import { previewReconcile, applyReconcile } from "./reconcile.js";
import { pushConfigured, emailConfigured, pushToUser, vapidPublic } from "./notify.js";
import webpush from "web-push";
import { weeklySummary } from "./summary.js";
import { z } from "zod";

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
  return c.json({ ...u, initial: row?.initial ?? initial, appearance: row?.appearance ?? "system", showBars: row?.showBars ?? true, avatarEmoji: row?.avatarEmoji ?? "🙂", avatarUrl: row?.avatarUrl ?? null, pushRecurring: row?.pushRecurring ?? true, weeklyEmail: row?.weeklyEmail ?? false, phoneNav: row?.phoneNav ?? null, textSize: row?.textSize ?? "normal" });
});

const PHONE_NAV_SCREENS = ["home", "budget", "transactions", "classic", "reports", "tracked"] as const;
app.put("/me", async (c) => {
  const p = z.object({ avatarEmoji: z.string().trim().max(8).optional(), avatarUrl: z.string().max(60_000).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().optional(), appearance: z.enum(["system", "light", "dark"]).optional(), textSize: z.enum(["small", "normal", "large", "larger"]).optional(), showBars: z.boolean().optional(), sounds: z.boolean().optional(), pushRecurring: z.boolean().optional(), weeklyEmail: z.boolean().optional(), phoneNav: z.array(z.enum(PHONE_NAV_SCREENS)).length(4).nullable().optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  if (p.data.phoneNav && new Set(p.data.phoneNav).size !== 4) return c.json({ error: "Pick four different screens" }, 400);
  await db.update(t.users).set({ ...p.data, updatedAt: new Date() }).where(eq(t.users.id, c.get("user").id));
  return c.json({ ok: true });
});

// ---------- settings: everything the Settings screen edits ----------
app.get("/settings/all", async (c) => {
  const me = c.get("user").id;
  const [accts, groups, cats, layoutRow] = await Promise.all([db.select().from(t.accounts), db.select().from(t.categoryGroups), db.select().from(t.categories), db.select().from(t.settings).where(eq(t.settings.key, "classic_layout"))]);
  const layout = (layoutRow[0]?.value as { name: string; column: string; section: string }[] | undefined) ?? [];
  return c.json({
    accounts: accts.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({ id: a.id, name: a.name, type: a.type, onBudget: a.onBudget, owner: a.owner, startingBalance: a.startingBalance, startingDate: a.startingDate, closed: a.closed })),
    groups: groups.sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({ id: g.id, name: g.name, system: g.system })),
    categories: cats.sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, groupId: x.groupId, kind: x.kind, hidden: x.hiddenInBudget, classicBucket: x.classicBucket, classicRule: x.classicRule, favourite: (() => { const v = x.favouriteOrder?.[me] ?? x.favouriteOrder?._ ?? null; return v === null || v < 0 ? null : v; })() })),
    classicLines: layout.map((l) => ({ name: l.name, column: l.column, section: l.section })),
  });
});
app.post("/groups", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "A group needs a name" }, 400);
  const n = (await db.select().from(t.categoryGroups)).length;
  const id = `grp-${Date.now().toString(36)}`;
  await db.insert(t.categoryGroups).values({ id, name: p.data.name, sortOrder: n, system: false, updatedBy: c.get("user").id });
  return c.json({ id });
});
app.put("/groups/:id", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  await db.update(t.categoryGroups).set({ name: p.data.name, updatedBy: c.get("user").id, updatedAt: new Date() }).where(eq(t.categoryGroups.id, c.req.param("id")));
  return c.json({ ok: true });
});
app.post("/accounts", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["checking", "savings", "credit_card"]), owner: z.enum(["D", "E", "shared"]), onBudget: z.boolean(), startingBalance: z.number().int(), startingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: p.error.issues.map((i) => i.message).join("; ") }, 400);
  const all = await db.select().from(t.accounts);
  if (all.some((a) => a.name.toLowerCase() === p.data.name.toLowerCase())) return c.json({ error: "That account name is taken" }, 400);
  const id = `acct-${Date.now().toString(36)}`;
  await db.insert(t.accounts).values({ id, ...p.data, sortOrder: all.length, updatedBy: c.get("user").id });
  return c.json({ id });
});
app.put("/accounts/:id", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60).optional(), type: z.enum(["checking", "savings", "credit_card"]).optional(), owner: z.enum(["D", "E", "shared"]).optional(), onBudget: z.boolean().optional(), closed: z.boolean().optional(), startingBalance: z.number().int().optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  await db.update(t.accounts).set({ ...p.data, updatedBy: c.get("user").id, updatedAt: new Date() }).where(eq(t.accounts.id, c.req.param("id")));
  return c.json({ ok: true });
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

// ---- phase 2: ledger ----
app.get("/lists", async (c) => c.json(await lists(db, c.get("user").id)));

app.get("/transactions", async (c) => {
  const q = c.req.query();
  const limit = q.limit ? Number(q.limit) : undefined;
  return c.json(await listTransactions(db, c.get("user").id, { accountId: q.account, month: q.month, categoryId: q.category, search: q.q, limit }));
});
app.get("/transactions/duplicate", async (c) => {
  const q = c.req.query();
  return c.json({ duplicate: await findDuplicate(db, q.payee ?? "", Number(q.amount), q.date ?? today(), q.exclude) });
});
app.post("/transactions", async (c) => {
  const parsed = entrySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const id = await createTransaction(db, c.get("user").id, parsed.data);
  return c.json({ id });
});
app.put("/transactions/:id", async (c) => {
  const parsed = entrySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  await updateTransaction(db, c.get("user").id, c.req.param("id"), parsed.data);
  return c.json({ ok: true });
});
app.delete("/transactions/:id", async (c) => {
  const again = c.req.query("undo") === "1" ? { landsAgainOn: null } : await skippedPending(db, c.req.param("id"), today());
  await deleteTransaction(db, c.get("user").id, c.req.param("id"), c.req.query("undo") === "1");
  return c.json({ ok: true, ...again });
});

// ---- phase 2: assigning money ----
const monthKey = z.string().regex(/^\d{4}-\d{2}-01$/);
app.post("/assign", async (c) => {
  const p = z.object({ month: monthKey, categoryId: z.string(), amount: z.number().int() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad request" }, 400);
  const id = await typeAssigned(db, c.get("user").id, p.data.month, p.data.categoryId, p.data.amount);
  return c.json({ moveId: id });
});
app.post("/move", async (c) => {
  const p = z.object({ month: monthKey, from: z.string().nullable(), to: z.string().nullable(), amount: z.number().int().positive(), how: z.enum(["move", "release"]).optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad request" }, 400);
  const id = await move(db, c.get("user").id, p.data.month, p.data.from, p.data.to, p.data.amount, p.data.how ?? "move");
  return c.json({ moveId: id });
});
app.post("/move/undo", async (c) => {
  const p = z.object({ moveIds: z.array(z.string()) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad request" }, 400);
  for (const id of p.data.moveIds) await undoMove(db, c.get("user").id, id);
  return c.json({ ok: true });
});
app.get("/moves/:month", async (c) => c.json(await recentMoves(db, c.req.param("month"))));
app.post("/auto-assign", async (c) => {
  const p = z.object({ month: monthKey, option: z.enum(["underfunded", "assigned_last_month", "spent_last_month", "average_assigned", "average_spent", "reduce_overfunding", "reset_available", "reset_assigned"]), only: z.array(z.string()).optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad request" }, 400);
  const ids = await autoAssign(db, c.get("user").id, p.data.month, p.data.option, p.data.only);
  return c.json({ moveIds: ids });
});
app.get("/category/:id/history/:month", async (c) => c.json(await categoryHistory(db, c.req.param("id"), c.req.param("month"))));

// ---------- goals (append-only by month) and categories ----------
const goalBody = z.object({ validFrom: monthKey, type: z.enum(["refill_to", "set_aside"]), amount: z.number().int().min(0), frequencyMonths: z.number().int().min(1).max(60).nullable(), targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });
app.get("/category/:id/goals", async (c) => {
  const rows = await db.select().from(t.goals).where(eq(t.goals.categoryId, c.req.param("id")));
  return c.json(rows.sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1)).map((g) => ({ validFrom: g.validFrom, type: g.type, amount: g.amount, frequencyMonths: g.frequencyMonths, targetDate: g.targetDate })));
});
app.put("/category/:id/goal", async (c) => {
  const p = goalBody.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: p.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user").id, categoryId = c.req.param("id");
  const row = { id: `goal-${categoryId}-${p.data.validFrom}`, categoryId, validFrom: p.data.validFrom, type: p.data.type, amount: p.data.amount, frequencyMonths: p.data.targetDate ? null : p.data.frequencyMonths ?? 1, targetDate: p.data.targetDate, updatedBy: me, updatedAt: new Date() };
  await db.insert(t.goals).values(row).onConflictDoUpdate({ target: [t.goals.categoryId, t.goals.validFrom], set: { type: row.type, amount: row.amount, frequencyMonths: row.frequencyMonths, targetDate: row.targetDate, updatedBy: me, updatedAt: row.updatedAt } });
  return c.json({ ok: true });
});
app.delete("/category/:id/goal/:validFrom", async (c) => {
  await db.delete(t.goals).where(and(eq(t.goals.categoryId, c.req.param("id")), eq(t.goals.validFrom, c.req.param("validFrom"))));
  return c.json({ ok: true });
});
app.post("/categories", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60), emoji: z.string().trim().max(8).nullable(), groupId: z.string(), goal: goalBody.optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "A category needs a name and a group" }, 400);
  const me = c.get("user").id;
  const existing = await db.select().from(t.categories);
  if (existing.some((x) => x.name.toLowerCase() === p.data.name.toLowerCase())) return c.json({ error: `There is already a category called ${p.data.name}` }, 400);
  const id = `cat-${Date.now().toString(36)}`;
  await db.insert(t.categories).values({ id, groupId: p.data.groupId, name: p.data.name, emoji: p.data.emoji || null, kind: "normal", sortOrder: existing.filter((x) => x.groupId === p.data.groupId).length, updatedBy: me });
  if (p.data.goal && p.data.goal.amount > 0) await db.insert(t.goals).values({ id: `goal-${id}-${p.data.goal.validFrom}`, categoryId: id, validFrom: p.data.goal.validFrom, type: p.data.goal.type, amount: p.data.goal.amount, frequencyMonths: p.data.goal.targetDate ? null : p.data.goal.frequencyMonths ?? 1, targetDate: p.data.goal.targetDate, updatedBy: me });
  return c.json({ id });
});
app.put("/categories/:id", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60).optional(), emoji: z.string().trim().max(8).nullable().optional(), groupId: z.string().optional(), hiddenInBudget: z.boolean().optional(),
    classicBucket: z.string().nullable().optional(), classicRule: z.enum(["none", "by_account", "utilities_split", "phone_split", "drive_split"]).optional(), favourite: z.boolean().optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  const me = c.get("user").id, id = c.req.param("id");
  const { favourite, ...rest } = p.data;
  const set: Record<string, unknown> = { ...rest, updatedBy: me, updatedAt: new Date() };
  if (favourite !== undefined) {
    // my own pin order: appended at the end when pinned, removed when unpinned (the shared "_" order from the sheet stays as the fallback for the other person)
    const all = await db.select().from(t.categories);
    const cur = all.find((x) => x.id === id)?.favouriteOrder ?? {};
    const next = { ...cur } as Record<string, number>;
    if (favourite) next[me] = Math.max(-1, ...all.map((x) => x.favouriteOrder?.[me] ?? x.favouriteOrder?._ ?? -1)) + 1; else { next[me] = -1; }
    set.favouriteOrder = next;
  }
  await db.update(t.categories).set(set).where(eq(t.categories.id, id));
  return c.json({ ok: true });
});

// ---------- category order (drag and drop on the Budget screen) ----------
app.put("/categories/reorder", async (c) => {
  const p = z.object({ groups: z.array(z.object({ groupId: z.string(), ids: z.array(z.string()) })) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  const me = c.get("user").id;
  for (const g of p.data.groups) for (let i = 0; i < g.ids.length; i++) {
    await db.update(t.categories).set({ groupId: g.groupId, sortOrder: i, updatedBy: me, updatedAt: new Date() }).where(eq(t.categories.id, g.ids[i]!));
  }
  return c.json({ ok: true });
});

// ---------- tags ----------
const TAG_PALETTE = ["#FFE8A3", "#CDF3D8", "#E7F1FB", "#FBE4E2", "#EADCF8", "#FFD9C2", "#D9F2F2", "#E6E9EE"];
app.post("/tags", async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "Tag needs a name" }, 400);
  const existing = await db.select().from(t.tags);
  const dup = existing.find((x) => x.name.toLowerCase() === p.data.name.toLowerCase());
  if (dup) return c.json({ tag: { id: dup.id, name: dup.name, color: dup.color } });
  const me = c.get("user").id;
  const tag = { id: `tag-${Date.now().toString(36)}`, name: p.data.name, color: p.data.color ?? TAG_PALETTE[existing.length % TAG_PALETTE.length]!, sortOrder: existing.length, updatedBy: me };
  await db.insert(t.tags).values(tag);
  return c.json({ tag: { id: tag.id, name: tag.name, color: tag.color } });
});

// ---------- classic ----------
const validMonth = (s: string | undefined) => (s && /^\d{4}-\d{2}-01$/.test(s) ? s : null);
app.get("/classic/:month", async (c) => {
  const m = validMonth(c.req.param("month"));
  if (!m) return c.json({ error: "month must be YYYY-MM-01" }, 400);
  return c.json(await classicPayload(db, m, today(), c.get("user").id));
});
app.get("/classic", async (c) => c.json(await classicPayload(db, today().slice(0, 7) + "-01", today(), c.get("user").id)));

// ---------- tracked amounts ----------
app.get("/tracked", async (c) => c.json({ tracked: await listTracked(db) }));
app.get("/tracked/:id/entries", async (c) => c.json({ entries: await trackedEntries(db, c.req.param("id")) }));
app.post("/tracked", async (c) => {
  const p = trackedInput.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "A tracked amount needs a name, an amount and the date it arrived" }, 400);
  return c.json({ id: await createTracked(db, c.get("user").id, p.data) });
});
app.put("/tracked/:id", async (c) => {
  const p = trackedInput.partial().extend({ closed: z.boolean().optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "Invalid tracked amount" }, 400);
  await updateTracked(db, c.get("user").id, c.req.param("id"), p.data);
  return c.json({ ok: true });
});
app.delete("/tracked/:id", async (c) => c.json({ result: await deleteTracked(db, c.req.param("id")) }));

// ---------- reports ----------
app.get("/reports/:month", async (c) => {
  const m = validMonth(c.req.param("month"));
  if (!m) return c.json({ error: "month must be YYYY-MM-01" }, 400);
  return c.json(await reportsPayload(db, m, today()));
});
app.get("/reports", async (c) => c.json(await reportsPayload(db, today().slice(0, 7) + "-01", today())));
const classicTypedSchema = z.object({ owner: z.enum(["D", "E", "shared"]), income: z.number().int().optional(), incomeActual: z.number().int().optional(), typed: z.record(z.string(), z.number().int()).optional() });
app.put("/classic/:month", async (c) => {
  const m = validMonth(c.req.param("month"));
  if (!m) return c.json({ error: "month must be YYYY-MM-01" }, 400);
  const body = classicTypedSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  await saveClassicTyped(db, m, c.get("user").id, body.data);
  return c.json({ ok: true });
});

// Daily job (Vercel cron): recurring entries, pushes, sheet mirror, backups, Monday summary.
app.get("/cron/daily", async (c) => {
  const auth = c.req.header("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return c.text("forbidden", 403);
  const ran: Record<string, unknown> = {};
  if (mirrorConfigured() && (await sheetId(db))) {
    const system = (await db.select().from(t.users))[0]?.id ?? "system";
    try { ran.inbox = await pickUpInbox(db, system); } catch (e) { ran.inboxError = (e as Error).message; }
    try { ran.mirror = await mirrorToSheet(db, system, { backup: true }); } catch (e) { ran.mirrorError = (e as Error).message; }
  }
  try {
    const system = (await db.select().from(t.users))[0]?.id ?? "system";
    const r = await createDueRecurring(db, today(), system); ran.recurring = r;
    if (r.created.length) for (const u of await db.select().from(t.users)) if (u.pushRecurring) await pushToUser(db, u.id, { title: `${r.created.length} ${r.created.length === 1 ? "bill" : "bills"} to confirm`, body: r.created.join(", "), url: "/#home", tag: "recurring" });
  } catch (e) { ran.recurringError = (e as Error).message; }
  if (new Date(today()).getUTCDay() === 1) { try { ran.weekly = await weeklySummary(db, today()); } catch (e) { ran.weeklyError = (e as Error).message; } }
  return c.json({ ok: true, ran });
});

// ---------- recurring bills and pending entries ----------
const recurringBody = z.object({ payee: z.string().trim().min(1).max(80), accountId: z.string(), categoryId: z.string().nullable(), memo: z.string().max(200).nullable(), amount: z.number().int(), dayOfMonth: z.number().int().min(1).max(31).nullable(), everyDays: z.number().int().min(1).max(366).nullable().optional(), anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), active: z.boolean() });
app.get("/recurring", async (c) => c.json((await db.select().from(t.recurring)).sort((a, b) => (a.dayOfMonth ?? 99) - (b.dayOfMonth ?? 99) || a.sortOrder - b.sortOrder).map((r) => ({ id: r.id, payee: r.payee, accountId: r.accountId, categoryId: r.categoryId, memo: r.memo, amount: r.amount, dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate, active: r.active, lastCreatedMonth: r.lastCreatedMonth, nextDue: nextDue({ dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate }, today()) }))));
app.post("/recurring", async (c) => {
  const p = recurringBody.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: p.error.issues.map((i) => i.message).join("; ") }, 400);
  const id = `rec-${Date.now().toString(36)}`;
  await db.insert(t.recurring).values({ id, ...p.data, sortOrder: (await db.select().from(t.recurring)).length, updatedBy: c.get("user").id });
  return c.json({ id });
});
app.put("/recurring/:id", async (c) => {
  const p = recurringBody.partial().safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad body" }, 400);
  await db.update(t.recurring).set({ ...p.data, updatedBy: c.get("user").id, updatedAt: new Date() }).where(eq(t.recurring.id, c.req.param("id")));
  if (p.data.dayOfMonth !== undefined || p.data.everyDays !== undefined || p.data.anchorDate !== undefined) await realignPending(db, c.req.param("id"), today());
  return c.json({ ok: true });
});
app.delete("/recurring/:id", async (c) => { await db.delete(t.recurring).where(eq(t.recurring.id, c.req.param("id"))); return c.json({ ok: true }); });
app.post("/recurring/run", async (c) => c.json(await createDueRecurring(db, today(), c.get("user").id)));
app.get("/pending", async (c) => c.json(await pending(db)));
app.post("/transactions/:id/confirm", async (c) => {
  const p = z.object({ amount: z.number().int().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: "bad body" }, 400);
  await confirmEntry(db, c.get("user").id, c.req.param("id"), p.data);
  return c.json({ ok: true });
});

// ---------- notifications ----------
app.get("/push/config", async (c) => {
  const me = c.get("user").id;
  const subs = await db.select().from(t.pushSubscriptions).where(eq(t.pushSubscriptions.userId, me));
  const pub = vapidPublic(), priv = (process.env.VAPID_PRIVATE_KEY ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const keyProblem = !pub ? "VAPID_PUBLIC_KEY is missing" : pub.length !== 87 ? `VAPID_PUBLIC_KEY should be 87 characters, it is ${pub.length}${pub.length === 43 ? " — that looks like the private key" : ""}` : priv.length !== 43 ? `VAPID_PRIVATE_KEY should be 43 characters, it is ${priv.length}${priv.length === 87 ? " — that looks like the public key" : ""}` : null;
  return c.json({ push: pushConfigured(), email: emailConfigured(), keyProblem, publicKey: vapidPublic() || null, devices: subs.map((s) => ({ id: s.id, label: s.deviceLabel, endpoint: s.endpoint })) });
});
app.post("/push/subscribe", async (c) => {
  const p = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }), label: z.string().max(80).optional() }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "bad subscription" }, 400);
  const me = c.get("user").id;
  await db.insert(t.pushSubscriptions).values({ id: `sub-${Date.now().toString(36)}`, userId: me, endpoint: p.data.endpoint, keys: p.data.keys, deviceLabel: p.data.label ?? null })
    .onConflictDoUpdate({ target: t.pushSubscriptions.endpoint, set: { userId: me, keys: p.data.keys, deviceLabel: p.data.label ?? null } });
  return c.json({ ok: true });
});
app.delete("/push/subscribe", async (c) => {
  const p = z.object({ endpoint: z.string() }).safeParse(await c.req.json());
  if (p.success) await db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.endpoint, p.data.endpoint));
  return c.json({ ok: true });
});
// one-time helper: shows a fresh VAPID key pair to a signed-in person until the real keys are configured (then it stops working)
app.get("/push/generate-keys", async (c) => {
  if (pushConfigured()) return c.text("Push keys are already set up.", 400);
  const k = webpush.generateVAPIDKeys();
  return c.html(`<!doctype html><meta charset="utf-8"><title>Push keys</title><body style="font-family:system-ui;max-width:720px;margin:40px auto;line-height:1.5">
<h2>One-time push keys</h2><p>Copy these into Vercel → Settings → Environment Variables, then redeploy. This page stops working once they're set. Don't share the private key.</p>
<p><b>VAPID_PUBLIC_KEY</b><br><code style="word-break:break-all">${k.publicKey}</code></p>
<p><b>VAPID_PRIVATE_KEY</b><br><code style="word-break:break-all">${k.privateKey}</code></p>
<p><b>VAPID_SUBJECT</b><br><code>mailto:${c.get("user").email}</code></p></body>`);
});
app.post("/push/test", async (c) => c.json({ sent: await pushToUser(db, c.get("user").id, { title: "D&E Budget", body: "Notifications are working on this device.", url: "/#home", tag: "test" }) }));
app.post("/summary/weekly", async (c) => c.json(await weeklySummary(db, today())));

// ---------- bank CSV reconciliation ----------
app.post("/reconcile/preview", async (c) => {
  const p = z.object({ accountId: z.string(), csv: z.string().min(1).max(2_000_000) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "Pick an account and a CSV file" }, 400);
  try { return c.json(await previewReconcile(db, p.data.accountId, p.data.csv, today())); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
});
app.post("/reconcile/apply", async (c) => {
  const p = z.object({ accountId: z.string(), matched: z.array(z.string()), mismatches: z.array(z.object({ id: z.string(), note: z.string().max(200) })),
    add: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), payee: z.string().max(120), memo: z.string().max(200), amount: z.number().int(), categoryId: z.string().nullable(), transferToAccountId: z.string().nullable() })) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: p.error.issues.map((i) => i.message).join("; ") }, 400);
  return c.json(await applyReconcile(db, c.get("user").id, p.data.accountId, p.data));
});

// ---------- sheet mirror (manual runs from Settings) ----------
app.get("/mirror/status", async (c) => {
  const last = await db.select().from(t.settings).where(eq(t.settings.key, "mirror_last"));
  return c.json({ configured: mirrorConfigured(), sheetId: await sheetId(db), last: last[0]?.value ?? null, backupFolder: !!process.env.BACKUP_FOLDER_ID });
});
app.put("/mirror/sheet", async (c) => {
  const p = z.object({ sheetId: z.string().trim().min(10) }).safeParse(await c.req.json());
  if (!p.success) return c.json({ error: "Paste the spreadsheet's id or link" }, 400);
  const m = p.data.sheetId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const idv = m ? m[1]! : p.data.sheetId;
  await db.insert(t.settings).values({ key: "sheet_id", value: idv as unknown as object, updatedAt: new Date() }).onConflictDoUpdate({ target: t.settings.key, set: { value: idv as unknown as object, updatedAt: new Date() } });
  return c.json({ ok: true, sheetId: idv });
});
app.post("/mirror/run", async (c) => {
  try { return c.json(await mirrorToSheet(db, c.get("user").id, { backup: false })); } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});
app.post("/mirror/inbox", async (c) => {
  try { return c.json(await pickUpInbox(db, c.get("user").id)); } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

export type App = typeof app;
