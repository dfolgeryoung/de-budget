import { describe, it, expect } from "vitest";
import { filesToPrune, describeSnapshot } from "../src/server/backup";

const f = (date: string) => ({ id: date, name: `de-budget-backup-${date}.json`, date });
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return f(d.toISOString().slice(0, 10)); });

describe("backup retention: last 30 nights + the first of each month", () => {
  it("keeps the last 30 days and the first backup of every month, prunes the rest", () => {
    const files = days("2026-08-10", 100); // Aug 10 → Nov 17
    const prune = new Set(filesToPrune(files, 30, "2026-11-17"));
    expect(prune.has("2026-11-17")).toBe(false);
    expect(prune.has("2026-10-18")).toBe(false); // 30 days back, kept
    expect(prune.has("2026-10-17")).toBe(true); // 31 days back, gone
    expect(prune.has("2026-10-01")).toBe(false); // first of October, kept
    expect(prune.has("2026-09-01")).toBe(false);
    expect(prune.has("2026-08-10")).toBe(false); // the first backup ever is August's monthly
    expect(prune.has("2026-08-11")).toBe(true);
    expect(files.length - prune.size).toBe(31 + 3); // 31 nights (today inclusive) + Aug, Sep, Oct firsts
  });
  it("prunes nothing in the first month", () => {
    expect(filesToPrune(days("2026-11-01", 13), 30, "2026-11-13")).toEqual([]);
  });
});

describe("describeSnapshot", () => {
  it("rejects anything that isn't a backup", () => {
    expect(describeSnapshot({ hello: 1 }).ok).toBe(false);
    expect(describeSnapshot(null).ok).toBe(false);
  });
  it("counts the tables of a real one", () => {
    const d = describeSnapshot({ app: "de-budget", version: 1, takenAt: "2026-11-13T07:00:00Z", tables: { transactions: [{}, {}], accounts: [{}] } });
    expect(d.ok && d.counts.transactions).toBe(2);
    expect(d.ok && d.counts.goals).toBe(0);
  });
});
