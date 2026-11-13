import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { mapState, type SheetState } from "../src/budget/fromState";
import { encodeLedger } from "../src/server/mirror";

const real = new URL("./fixtures/state-2026-11-11.json", import.meta.url);
const file = existsSync(real) ? real : new URL("./fixtures/state-scrubbed.json", import.meta.url);
const state = JSON.parse(readFileSync(file, "utf8")) as SheetState;

describe("ledger mirror round-trips the export", () => {
  it("writes the same rows the sheet exported (date, account, payee, category, memo, outflow, inflow, hidden)", () => {
    const m = mapState(state);
    const entry = new Map(m.entries.map((e) => [e.id, e]));
    const txns = m.input.transactions.map((x) => ({ id: x.id, date: x.date, accountId: x.accountId, payee: entry.get(x.id)?.payee ?? null, memo: entry.get(x.id)?.memo ?? null, amount: x.amount, transferToAccountId: x.transferToAccountId ?? null, sharedFiftyFifty: x.sharedFiftyFifty ?? false, hidden: entry.get(x.id)?.hidden ?? false, lines: x.lines }));
    const acct = new Map([...m.names.accounts].map(([name, id]) => [id, name]));
    const cat = new Map([...m.names.categories].map(([name, id]) => [id, name]));
    const rows = encodeLedger(txns, acct, cat);
    // the export's own ledger: [date, account, payee, category, memo, out, in, hidden], newest first
    const want = state.ledger.filter((r) => r[0]).map((r) => [r[7] ? true : null, `${Number(r[0]!.slice(5, 7))}/${Number(r[0]!.slice(8, 10))}/${r[0]!.slice(0, 4)}`, r[1], r[2], r[3], r[4] ?? "", r[5] ?? null, r[6] ?? null]);
    const key = (r: (string | number | boolean | null)[]) => JSON.stringify(r);
    const got = new Map<string, number>(), exp = new Map<string, number>();
    for (const r of rows) got.set(key(r), (got.get(key(r)) ?? 0) + 1);
    for (const r of want) exp.set(key(r), (exp.get(key(r)) ?? 0) + 1);
    const missing = [...exp].filter(([k, n]) => (got.get(k) ?? 0) < n).map(([k]) => k);
    const extra = [...got].filter(([k, n]) => (exp.get(k) ?? 0) < n).map(([k]) => k);
    expect({ missing: missing.slice(0, 5), extra: extra.slice(0, 5), counts: [rows.length, want.length] }).toEqual({ missing: [], extra: [], counts: [want.length, want.length] });
  });
});

import { parseLedgerRows, encodeLedgerGroups, newInSheet, type SheetLedgerRow } from "../src/server/mirror";

describe("reconcile: what the sheet has that the app doesn't", () => {
  const m = mapState(state);
  const entry = new Map(m.entries.map((e) => [e.id, e]));
  const txns = m.input.transactions.map((x) => ({ id: x.id, date: x.date, accountId: x.accountId, payee: entry.get(x.id)?.payee ?? null, memo: entry.get(x.id)?.memo ?? null, amount: x.amount, transferToAccountId: x.transferToAccountId ?? null, sharedFiftyFifty: x.sharedFiftyFifty ?? false, hidden: entry.get(x.id)?.hidden ?? false, lines: x.lines }));
  const acct = new Map([...m.names.accounts].map(([name, id]) => [id, name]));
  const cat = new Map([...m.names.categories].map(([name, id]) => [id, name]));
  const acctId = new Map([...m.names.accounts].map(([name, id]) => [name.toLowerCase(), id]));
  const catId = new Map([...m.names.categories].map(([name, id]) => [name.toLowerCase(), id]));
  const groups = encodeLedgerGroups(txns, acct, cat);
  // what the sheet would hand back: the same rows, formatted as text
  const asSheet = (rows: (string | number | boolean | null)[][]) => rows.map((r) => r.map((v, i) => (v === null ? "" : typeof v === "number" ? (i >= 6 ? `$${v.toFixed(2)}` : String(v)) : String(v))) as SheetLedgerRow);

  it("finds nothing new when the sheet mirrors the app exactly", () => {
    const parsed = parseLedgerRows(asSheet(groups.flatMap((g) => g.rows)));
    expect(parsed.length).toBe(txns.length);
    expect(newInSheet(parsed, groups, acctId, catId, acct, cat)).toEqual([]);
  });

  it("finds exactly the rows typed into the sheet (plain, 50/50, split, transfer, hidden)", () => {
    const extra: SheetLedgerRow[] = [
      ["", "11/12/2026", "D Checking", "Sheetz", "Gas", "", "$41.10", ""],
      ["", "11/12/2026", "E Checking (split)", "Helms boys", "Garden/Home Decor", "", "$125.00", ""],
      ["", "11/12/2026", "CapitalOne", "Target", "Split across categories", "lamp", "$60.00", ""],
      ["", "11/12/2026", "", "↳ Target", "Groceries", "", "$35.00", ""],
      ["", "11/12/2026", "", "↳ Target", "David Fun Money", "", "$25.00", ""],
      ["", "11/12/2026", "D Checking", "", "Transfer: Money Market", "", "$500.00", ""],
      ["TRUE", "11/12/2026", "E Checking", "Surprise", "Gifts", "", "$80.00", ""],
    ];
    const parsed = parseLedgerRows([...extra, ...asSheet(groups.flatMap((g) => g.rows))]);
    const found = newInSheet(parsed, groups, acctId, catId, acct, cat).map((x) => x.entry);
    expect(found.map((e) => [e.payee || e.transferTo, e.amount, e.split, e.hidden, e.lines.length])).toEqual([
      ["Sheetz", -4110, false, false, 1], ["Helms boys", -12500, true, false, 1], ["Target", -6000, false, false, 2], ["Money Market", -50000, false, false, 0], ["Surprise", -8000, false, true, 1],
    ]);
    // a second pass after they were added finds nothing
    const added = found.map((e) => ({ id: "n", date: e.date, accountId: acctId.get(e.account.toLowerCase())!, payee: e.payee || null, memo: e.memo || null, amount: e.amount, transferToAccountId: e.transferTo ? acctId.get(e.transferTo.toLowerCase())! : null, sharedFiftyFifty: e.split, hidden: e.hidden, lines: e.transferTo ? [] : e.lines.map((l) => ({ categoryId: catId.get(l.category.toLowerCase())!, amount: l.amount })) }));
    expect(newInSheet(parsed, encodeLedgerGroups([...txns, ...added], acct, cat), acctId, catId, acct, cat)).toEqual([]);
  });
});
