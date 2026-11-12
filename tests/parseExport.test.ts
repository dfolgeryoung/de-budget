import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseExport, parseCsv } from "../src/budget/parseExport";

describe("csv", () => {
  it("handles quotes, commas and newlines", () => {
    expect(parseCsv('a,"b,c","d""e"\n1,,3\n')).toEqual([["a", "b,c", 'd"e'], ["1", "", "3"]]);
  });
});

// The raw export is real data and not committed; the TS parser is checked against the Python extractor's output when both are present.
const exportPath = "/home/claude/dl/export_1111.txt";
const statePath = new URL("./fixtures/state-2026-11-11.json", import.meta.url);
describe.skipIf(!existsSync(exportPath) || !existsSync(statePath))("parseExport agrees with extract_state.py", () => {
  it("accounts, months, ledger and history match", () => {
    const got = parseExport(readFileSync(exportPath, "utf8"));
    const want = JSON.parse(readFileSync(statePath, "utf8"));
    expect(got.accounts).toEqual(want.accounts);
    expect(got.first_month).toBe(want.first_month);
    expect(got.ledger).toEqual(want.ledger);
    expect(Object.keys(got.months).sort()).toEqual(Object.keys(want.months).sort());
    for (const m of Object.keys(got.months)) {
      expect(got.months[m]!.cats).toEqual(want.months[m].cats);
      expect(got.months[m]!.groups).toEqual(want.months[m].groups);
      expect(got.months[m]!.accounts).toEqual(want.months[m].accounts);
      expect(got.months[m]!.rta).toEqual(want.months[m].rta);
    }
    for (const m of Object.keys(want.history)) expect(got.history[m]!.cats).toEqual(want.history[m].cats);
    expect(got.recurring).toEqual(want.recurring);
  });
});
