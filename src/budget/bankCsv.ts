/**
 * Bank CSV parsing (SECU's export, and anything with Date / Description / Amount-or-Credit-Debit columns).
 * Pure: takes the file's text, returns clean rows; nothing here touches the database.
 */
import { parseCsv, dt, num } from "./parseExport.js";

export interface BankRow {
  date: string; // the purchase date when the description carries one ("DATE 11-07"), else the posting date
  postedDate: string;
  payee: string; // cleaned: the bracketed name SECU appends, else the description with codes stripped
  description: string; // raw
  amount: number; // cents, signed (debits negative)
  transfer: boolean; // looks like a transfer between the bank's own accounts
  bankCategory: string | null;
}
export interface BankFile { account: string | null; balance: number | null; asOf: string | null; rows: BankRow[] }

const norm = (s: string) => s.trim().toLowerCase();

export function parseBankCsv(text: string): BankFile {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  let account: string | null = null, balance: number | null = null, asOf: string | null = null;
  // header row: the first row that has a Date column and an amount column
  let h = -1, cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i]!.map(norm);
    const di = r.findIndex((c) => c === "date" || c === "transaction date" || c === "posted date");
    const ai = r.findIndex((c) => c === "amount" || c === "debit" || c === "credit" || c === "withdrawal" || c === "deposit");
    if (di >= 0 && ai >= 0) { h = i; r.forEach((c, k) => { cols[c] = k; }); break; }
    // preamble lines: "Checking","******6105" / "Balance as of 11/12/2026","6432.35"
    const first = rows[i]![0] ?? "";
    const m = first.match(/balance as of (\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (m) { asOf = dt(m[1]); balance = num(rows[i]![1]) ?? null; }
    else if (rows[i]!.length === 2 && first && !account) account = `${first} ${rows[i]![1] ?? ""}`.trim();
  }
  if (h < 0) throw new Error("Couldn't find the header row (needs a Date column and an Amount, Debit or Credit column)");
  const pick = (r: string[], ...names: string[]) => { for (const n of names) if (cols[n] !== undefined) return r[cols[n]!] ?? ""; return ""; };
  const out: BankRow[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const posted = dt(pick(r, "date", "transaction date", "posted date"));
    if (!posted) continue; // blank line or the Totals row
    const credit = num(pick(r, "credit", "deposit")) ?? 0, debit = num(pick(r, "debit", "withdrawal")) ?? 0;
    const amountCol = num(pick(r, "amount"));
    const amount = Math.round(((amountCol ?? 0) + credit - Math.abs(debit)) * 100) || (amountCol !== null ? Math.round(amountCol * 100) : 0);
    const description = pick(r, "description", "memo", "payee", "name").trim();
    out.push({ date: purchaseDate(description, posted), postedDate: posted, payee: cleanPayee(description), description, amount, transfer: /\btransfer\b/i.test(description), bankCategory: pick(r, "category") || null });
  }
  return { account, balance: balance === null ? null : Math.round(balance * 100), asOf, rows: out };
}

/** "POINT OF SALE DEBIT L340 DATE 11-07 ..." carries the day it was spent; the posting date is a day or two later. */
export function purchaseDate(description: string, posted: string): string {
  const m = description.match(/\bDATE (\d{2})-(\d{2})\b/);
  if (!m) return posted;
  let y = Number(posted.slice(0, 4));
  const mm = m[1]!, dd = m[2]!;
  const candidate = `${y}-${mm}-${dd}`;
  if (candidate > posted) y -= 1; // a December purchase posting in January
  return `${y}-${mm}-${dd}`;
}

/** The friendly name in the trailing parentheses when the bank gives one, else the description with the codes stripped. */
export function cleanPayee(description: string): string {
  const paren = description.match(/\(([^()]*)\)\s*$/);
  if (paren && paren[1]!.trim()) return paren[1]!.trim().replace(/\s+/g, " ");
  return description
    .replace(/^(POINT OF SALE DEBIT|ACH (DEBIT|DEPOSIT|CREDIT)|INTERNET (DEBIT|CREDIT) TRANSFER|DEBIT CARD PURCHASE|CHECK CARD|RECURRING)\b/i, "")
    .replace(/\bL\d{3}\b|\bDATE \d{2}-\d{2}\b|#?\d{8,}|\*+\d{4}/g, "")
    .replace(/\s+/g, " ").trim() || description;
}
