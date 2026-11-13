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
