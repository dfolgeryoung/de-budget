/**
 * Backups: a snapshot of every table as one JSON document (plus a ledger CSV for spreadsheets), a restore that
 * replaces the database contents from a snapshot, and the retention rule for the nightly copies in Drive
 * (the last 30 nights, plus the first backup of each month, kept for good).
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";

export const BACKUP_VERSION = 1;
export const BACKUP_PREFIX = "de-budget-backup-";
export const SHEET_COPY_PREFIX = "DE Budget backup ";

/** Tables in dependency order: parents first, so a restore can insert top-down and delete bottom-up. */
const TABLES = {
  users: t.users,
  accounts: t.accounts,
  categoryGroups: t.categoryGroups,
  categories: t.categories,
  settings: t.settings,
  goals: t.goals,
  payees: t.payees,
  tags: t.tags,
  trackedAmounts: t.trackedAmounts,
  recurring: t.recurring,
  transactions: t.transactions,
  transactionLines: t.transactionLines,
  transactionTags: t.transactionTags,
  assignments: t.assignments,
  moneyMoves: t.moneyMoves,
  classicMonth: t.classicMonth,
  imports: t.imports,
} as const;
type TableName = keyof typeof TABLES;

export interface Snapshot { app: "de-budget"; version: number; takenAt: string; counts: Record<string, number>; tables: Record<string, unknown[]> }

export async function exportSnapshot(db: Db): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const name of Object.keys(TABLES) as TableName[]) {
    const rows = await db.select().from(TABLES[name]);
    tables[name] = rows; counts[name] = rows.length;
  }
  return { app: "de-budget", version: BACKUP_VERSION, takenAt: new Date().toISOString(), counts, tables };
}

/** The ledger as a spreadsheet: one row per entry (split lines joined), amounts in dollars. */
export async function exportLedgerCsv(db: Db): Promise<string> {
  const [txns, lines, accts, cats, tagRows, tagLinks] = await Promise.all([
    db.select().from(t.transactions), db.select().from(t.transactionLines), db.select().from(t.accounts), db.select().from(t.categories), db.select().from(t.tags), db.select().from(t.transactionTags),
  ]);
  const acct = new Map(accts.map((a) => [a.id, a.name])), cat = new Map(cats.map((c) => [c.id, c.name])), tag = new Map(tagRows.map((x) => [x.id, x.name]));
  const q = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const money = (c: number) => (c / 100).toFixed(2);
  const head = ["Date", "Account", "Payee", "Category", "Memo", "Amount", "Transfer to", "50/50", "Hidden", "Confirmed", "Bank status", "Tags", "Deleted", "Id"];
  const out = [head.join(",")];
  for (const x of txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const ls = lines.filter((l) => l.transactionId === x.id);
    const category = x.transferToAccountId ? "" : ls.length > 1 ? ls.map((l) => `${cat.get(l.categoryId ?? "") ?? "Ready to Assign"} ${money(l.amount)}`).join(" | ") : (cat.get(ls[0]?.categoryId ?? "") ?? "Ready to Assign");
    const tagsOf = tagLinks.filter((l) => l.transactionId === x.id).map((l) => tag.get(l.tagId) ?? "").join("; ");
    out.push([x.date, acct.get(x.accountId) ?? x.accountId, x.payee, category, x.memo, money(x.amount), x.transferToAccountId ? acct.get(x.transferToAccountId) ?? "" : "", x.sharedFiftyFifty ? "yes" : "", x.hidden ? "yes" : "", x.confirmed ? "yes" : "no", x.bankStatus, tagsOf, x.deletedAt ? "yes" : "", x.id].map(q).join(","));
  }
  return out.join("\n") + "\n";
}

/** What a snapshot holds, for the confirmation step. */
export function describeSnapshot(raw: unknown): { ok: true; takenAt: string; counts: Record<string, number> } | { ok: false; error: string } {
  const s = raw as Partial<Snapshot>;
  if (!s || s.app !== "de-budget" || typeof s.version !== "number" || !s.tables) return { ok: false, error: "That isn't a D&E Budget backup file" };
  if (s.version > BACKUP_VERSION) return { ok: false, error: `This backup is from a newer version of the app (v${s.version}); update the app first` };
  const counts: Record<string, number> = {};
  for (const name of Object.keys(TABLES)) counts[name] = Array.isArray(s.tables[name]) ? s.tables[name]!.length : 0;
  return { ok: true, takenAt: s.takenAt ?? "unknown", counts };
}

/** Date columns come back from JSON as strings; put them back as Dates for the timestamp columns. */
function revive(name: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of ["createdAt", "updatedAt", "deletedAt", "importedAt", "at", "lastSeenAt"]) if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
  void name;
  return out;
}

/**
 * Replace the database contents with a snapshot. The Neon HTTP driver has no transactions, so this runs table by
 * table: children are cleared first, then every table is re-inserted parents first. If it fails part way, running
 * the same restore again completes it.
 */
export async function restoreSnapshot(db: Db, raw: unknown): Promise<{ restored: Record<string, number> }> {
  const d = describeSnapshot(raw);
  if (!d.ok) throw new Error(d.error);
  const s = raw as Snapshot;
  const names = Object.keys(TABLES) as TableName[];
  for (const name of [...names].reverse()) await db.delete(TABLES[name]);
  const restored: Record<string, number> = {};
  for (const name of names) {
    const rows = (s.tables[name] ?? []) as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += 200) await db.insert(TABLES[name]).values(rows.slice(i, i + 200).map((r) => revive(name, r)) as never);
    restored[name] = rows.length;
  }
  await db.insert(t.settings).values({ key: "restored_at", value: new Date().toISOString() }).onConflictDoUpdate({ target: t.settings.key, set: { value: new Date().toISOString() } });
  return { restored };
}

export async function lastBackup(db: Db): Promise<{ at: string; name: string; bytes: number } | null> {
  const r = await db.select().from(t.settings).where(eq(t.settings.key, "last_backup"));
  return (r[0]?.value as { at: string; name: string; bytes: number } | undefined) ?? null;
}

/** Keep the last `keepDays` nightly files plus the first file of each month; everything else goes. Pure. */
export function filesToPrune(files: { id: string; name: string; date: string }[], keepDays = 30, today: string): string[] {
  const cutoff = new Date(today + "T00:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const byMonth = new Map<string, { id: string; date: string }>();
  for (const f of [...files].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const m = f.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, f); // the first backup of each month
  }
  const keep = new Set([...byMonth.values()].map((f) => f.id));
  return files.filter((f) => f.date < cutoffIso && !keep.has(f.id)).map((f) => f.id);
}

/** Nightly: upload today's snapshot to the backup folder, then prune both the snapshots and the sheet copies. */
export async function nightlyBackup(db: Db, today: string): Promise<{ uploaded: string; bytes: number; pruned: number } | { skipped: string }> {
  const folder = process.env.BACKUP_FOLDER_ID;
  if (!folder) return { skipped: "BACKUP_FOLDER_ID is not set" };
  const { driveUpload, driveList, driveDelete } = await import("./google.js");
  const snap = await exportSnapshot(db);
  const body = JSON.stringify(snap);
  const name = `${BACKUP_PREFIX}${today}.json`;
  // one per day: a rerun the same day replaces that day's file
  const existing = (await driveList(folder, BACKUP_PREFIX)).filter((f) => f.name === name);
  for (const f of existing) await driveDelete(f.id);
  await driveUpload(name, "application/json", body, folder);
  await db.insert(t.settings).values({ key: "last_backup", value: { at: new Date().toISOString(), name, bytes: body.length } })
    .onConflictDoUpdate({ target: t.settings.key, set: { value: { at: new Date().toISOString(), name, bytes: body.length } } });
  let pruned = 0;
  for (const prefix of [BACKUP_PREFIX, SHEET_COPY_PREFIX]) {
    const files = (await driveList(folder, prefix)).map((f) => ({ id: f.id, name: f.name, date: (f.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? f.createdTime.slice(0, 10)) }));
    for (const id of filesToPrune(files, 30, today)) { await driveDelete(id); pruned++; }
  }
  return { uploaded: name, bytes: body.length, pruned };
}
