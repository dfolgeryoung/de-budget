/**
 * Flags: a question one of you leaves on an entry ("what was this?"), replies, and a Resolve. An open flag shows on
 * both Home screens; adding a note pushes the other person.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { pushToUser } from "./notify.js";
import { formatMoney } from "../budget/money.js";

export interface FlagNote { id: string; userId: string; who: string; initial: string; text: string; at: string }
export interface FlaggedEntry { id: string; date: string; payee: string | null; amount: number; accountId: string; category: string | null; notes: FlagNote[]; openedBy: string; openedAt: string }

async function people(db: Db) { return new Map((await db.select().from(t.users)).map((u) => [u.id, u])); }

export async function notesFor(db: Db, transactionId: string): Promise<FlagNote[]> {
  const [rows, users] = await Promise.all([db.select().from(t.transactionNotes).where(eq(t.transactionNotes.transactionId, transactionId)), people(db)]);
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((n) => ({ id: n.id, userId: n.userId, who: users.get(n.userId)?.displayName.split(" ")[0] ?? "?", initial: users.get(n.userId)?.initial ?? "?", text: n.text, at: n.createdAt.toISOString() }));
}

/** Add a note; the entry is flagged open and the other person gets a push. */
export async function addNote(db: Db, me: string, transactionId: string, text: string): Promise<FlagNote[]> {
  const x = (await db.select().from(t.transactions).where(and(eq(t.transactions.id, transactionId), isNull(t.transactions.deletedAt))))[0];
  if (!x) throw new Error("No such entry");
  await db.insert(t.transactionNotes).values({ id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, transactionId, userId: me, text: text.trim() });
  await db.update(t.transactions).set({ flagOpen: true }).where(eq(t.transactions.id, transactionId));
  const users = await people(db);
  const from = users.get(me)?.displayName.split(" ")[0] ?? "Someone";
  for (const u of users.values()) if (u.id !== me) await pushToUser(db, u.id, { title: `${from} asked about ${x.payee || "an entry"} ${formatMoney(Math.abs(x.amount))}`, body: text.trim().slice(0, 140), url: "/#home", tag: `flag-${transactionId}` }).catch(() => 0);
  return notesFor(db, transactionId);
}

export async function resolveFlag(db: Db, me: string, transactionId: string, open: boolean) {
  await db.update(t.transactions).set({ flagOpen: open, updatedBy: me, updatedAt: new Date() }).where(eq(t.transactions.id, transactionId));
}

/** Entries with an open flag, newest question first. */
export async function flagged(db: Db): Promise<FlaggedEntry[]> {
  const [rows, lines, cats, users, notes] = await Promise.all([
    db.select().from(t.transactions).where(and(eq(t.transactions.flagOpen, true), isNull(t.transactions.deletedAt))).orderBy(desc(t.transactions.updatedAt)),
    db.select().from(t.transactionLines), db.select({ id: t.categories.id, name: t.categories.name, emoji: t.categories.emoji }).from(t.categories), people(db), db.select().from(t.transactionNotes),
  ]);
  return rows.map((x) => {
    const ns = notes.filter((n) => n.transactionId === x.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ls = lines.filter((l) => l.transactionId === x.id);
    const c = cats.find((c) => c.id === ls[0]?.categoryId);
    const first = ns[0];
    return {
      id: x.id, date: x.date, payee: x.payee, amount: x.amount, accountId: x.accountId,
      category: x.transferToAccountId ? "Transfer" : ls.length > 1 ? "Split" : c ? `${c.emoji ? c.emoji + " " : ""}${c.name}` : null,
      notes: ns.map((n) => ({ id: n.id, userId: n.userId, who: users.get(n.userId)?.displayName.split(" ")[0] ?? "?", initial: users.get(n.userId)?.initial ?? "?", text: n.text, at: n.createdAt.toISOString() })),
      openedBy: first ? users.get(first.userId)?.displayName.split(" ")[0] ?? "?" : "?", openedAt: (first?.createdAt ?? x.updatedAt).toISOString(),
    };
  }).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
}
