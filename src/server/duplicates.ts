/**
 * Possible duplicates: two live entries with the same payee and amount within a few days of each other — the usual
 * sign that one of you keyed it in the app and the other in the sheet. They show on Home until one is deleted or the
 * pair is marked "keep both" (remembered in settings so it doesn't come back).
 */
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { pushToUser } from "./notify.js";
import { formatMoney } from "../budget/money.js";

export const DUP_WINDOW_DAYS = 3;
const KEY = "dupes_ok";

export interface DupEntry { id: string; date: string; payee: string | null; memo: string | null; amount: number; account: string; category: string | null; enteredBy: string | null; createdAt: string }
export interface DupPair { key: string; a: DupEntry; b: DupEntry }

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/** Pairs of same-payee, same-amount entries within DUP_WINDOW_DAYS of each other, oldest first. */
export function pairUp(entries: DupEntry[], dismissed: Set<string>): DupPair[] {
  const groups = new Map<string, DupEntry[]>();
  for (const e of entries) {
    if (!e.payee) continue;
    const k = `${e.payee.trim().toLowerCase()}\u0000${e.amount}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: DupPair[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i]!, b = g[j]!;
      const days = Math.abs(Date.parse(b.date) - Date.parse(a.date)) / 86_400_000;
      if (days > DUP_WINDOW_DAYS) continue;
      const key = pairKey(a.id, b.id);
      if (!dismissed.has(key)) out.push({ key, a, b });
    }
  }
  return out.sort((x, y) => y.a.date.localeCompare(x.a.date));
}

export async function possibleDuplicates(db: Db): Promise<DupPair[]> {
  const [txns, lines, accts, cats, users, ok] = await Promise.all([
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
    db.select().from(t.transactionLines),
    db.select({ id: t.accounts.id, name: t.accounts.name }).from(t.accounts),
    db.select({ id: t.categories.id, name: t.categories.name, emoji: t.categories.emoji }).from(t.categories),
    db.select({ id: t.users.id, name: t.users.displayName }).from(t.users),
    db.select().from(t.settings).where(eq(t.settings.key, KEY)),
  ]);
  const acct = new Map(accts.map((a) => [a.id, a.name]));
  const cat = new Map(cats.map((c) => [c.id, `${c.emoji ? c.emoji + " " : ""}${c.name}`]));
  const who = new Map(users.map((u) => [u.id, u.name.split(" ")[0]!]));
  const entries: DupEntry[] = txns.filter((x) => !x.transferToAccountId).map((x) => {
    const ls = lines.filter((l) => l.transactionId === x.id);
    return {
      id: x.id, date: x.date, payee: x.payee, memo: x.memo, amount: x.amount, account: acct.get(x.accountId) ?? "?",
      category: ls.length > 1 ? "Split" : ls[0]?.categoryId ? cat.get(ls[0].categoryId) ?? null : null,
      enteredBy: x.createdBy ? who.get(x.createdBy) ?? null : null, createdAt: x.createdAt.toISOString(),
    };
  });
  const dismissed = new Set(((ok[0]?.value as string[] | undefined) ?? []));
  return pairUp(entries, dismissed);
}

/** Remember that these two are both real, so the pair stops showing. */
export async function keepBoth(db: Db, a: string, b: string): Promise<void> {
  const row = (await db.select().from(t.settings).where(eq(t.settings.key, KEY)))[0];
  const list = new Set((row?.value as string[] | undefined) ?? []);
  list.add(pairKey(a, b));
  await db.insert(t.settings).values({ key: KEY, value: [...list] }).onConflictDoUpdate({ target: t.settings.key, set: { value: [...list], updatedAt: new Date() } });
}

/** Push everyone (except `except`) about any pair that one of `newIds` just formed. Never throws. */
export async function notifyDuplicates(db: Db, newIds: string[], except?: string): Promise<number> {
  if (!newIds.length) return 0;
  try {
    const fresh = (await possibleDuplicates(db)).filter((p) => newIds.includes(p.a.id) || newIds.includes(p.b.id));
    if (!fresh.length) return 0;
    const users = await db.select({ id: t.users.id }).from(t.users);
    const first = fresh[0]!;
    const title = fresh.length === 1 ? `Possible duplicate: ${first.a.payee} ${formatMoney(Math.abs(first.a.amount))}` : `${fresh.length} possible duplicates`;
    const body = fresh.length === 1 ? `Two entries on ${first.a.date.slice(5).replace("-", "/")} and ${first.b.date.slice(5).replace("-", "/")}. Review on Home.` : fresh.slice(0, 3).map((p) => `${p.a.payee} ${formatMoney(Math.abs(p.a.amount))}`).join(", ") + " — review on Home.";
    for (const u of users) if (u.id !== except) await pushToUser(db, u.id, { title, body, url: "/#home", tag: "dupes" });
    return fresh.length;
  } catch { return 0; }
}
