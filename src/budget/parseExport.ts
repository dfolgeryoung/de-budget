/**
 * Parse the Google Sheets text export of the budget ("## Sheet name: X" blocks of CSV) into
 * the SheetState shape. A port of extract_state.py so the app can take the raw export directly.
 */
import type { SheetState, SheetMonth, SheetClassic } from "./fromState.js";
import type { ISODate } from "./dates.js";

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const cell = (rows: string[][], r: number, c: number) => rows[r]?.[c] ?? "";
const COL = (s: string) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

export function num(x: string | undefined): number | null {
  if (x == null) return null;
  let s = x.trim();
  if (s === "" || s === "-") return null;
  const neg = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  s = s.replace(/[$,()+\-]/g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}
export function dt(x: string | undefined): ISODate | null {
  if (!x) return null;
  const s = x.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function parseExport(text: string): SheetState {
  const sheets: Record<string, string[][]> = {};
  const blocks = text.replace(/^﻿/, "").split(/^## Sheet name: /m).slice(1);
  for (const b of blocks) {
    const nl = b.indexOf("\n");
    sheets[b.slice(0, nl).trim()] = parseCsv(b.slice(nl + 1));
  }
  const lg = sheets["Ledger"];
  if (!lg) throw new Error("No Ledger sheet in the export");
  const labels = new Map<string, number>();
  lg.forEach((r, i) => { const l = (r[0] ?? "").trim(); if (l && !labels.has(l)) labels.set(l, i); });
  const need = (k: string) => { const v = labels.get(k); if (v === undefined) throw new Error(`Ledger settings label "${k}" not found`); return v; };

  const accounts: SheetState["accounts"] = [];
  for (let r = need("Account") + 1; r < need("First budget month"); r++) {
    const name = cell(lg, r, COL("A")).trim();
    if (name) accounts.push([name, cell(lg, r, COL("B")), cell(lg, r, COL("C")), num(cell(lg, r, COL("D"))) ?? 0]);
  }
  const first_month = dt(cell(lg, need("First budget month"), COL("B")));
  const current_month = dt(cell(lg, need("Current month"), COL("B")));
  if (!first_month || !current_month) throw new Error("First/Current month missing in Ledger settings");

  const ledger: SheetState["ledger"] = [];
  for (let r = 3; r < lg.length; r++) {
    const d = cell(lg, r, COL("G")).trim();
    if (!d && !cell(lg, r, COL("H")).trim()) continue;
    ledger.push([dt(d), cell(lg, r, COL("H")), cell(lg, r, COL("I")), cell(lg, r, COL("J")), cell(lg, r, COL("K")),
      num(cell(lg, r, COL("L"))), num(cell(lg, r, COL("M"))), cell(lg, r, COL("F")).trim().toUpperCase() === "TRUE"]);
  }

  const months: Record<string, SheetMonth> = {};
  const history: SheetState["history"] = {};
  for (const [name, rows] of Object.entries(sheets)) {
    if (!/^[A-Z][a-z]{2} \d{4}$/.test(name)) continue;
    const isLive = cell(rows, 0, COL("AH")).trim() === "Previous month tab";
    if (isLive) {
      const cats: SheetMonth["cats"] = {};
      const groups: SheetMonth["groups"] = [];
      let cur: string | null = null;
      for (let r = 5; r < rows.length; r++) {
        const cat = cell(rows, r, COL("D")).trim();
        if (!cat) continue;
        const marker = cell(rows, r, COL("C")).trim();
        if (marker === "▾" || marker === "▸") { cur = cat; groups.push([cat, []]); continue; }
        const group = cell(rows, r, COL("AA")).trim();
        if (!group || !cur) continue; // notes and tips under the table have no group
        groups[groups.length - 1]![1].push(cat);
        cats[cat] = {
          assigned: num(cell(rows, r, COL("F"))), goal_type: cell(rows, r, COL("Q")).trim(), goal_amount: num(cell(rows, r, COL("R"))),
          freq: num(cell(rows, r, COL("T"))), goal_date: dt(cell(rows, r, COL("S"))),
          activity: num(cell(rows, r, COL("G"))), available: num(cell(rows, r, COL("H"))),
          group: group.replace(/^[▾▸]\s*/, ""),
        };
      }
      const accts: Record<string, number> = {};
      for (let r = 5; r < rows.length; r++) {
        const a = cell(rows, r, COL("A")).trim();
        const v = num(cell(rows, r, COL("B")));
        if (a && v !== null) accts[a] = v;
      }
      months[name] = { picked: cell(rows, 4, COL("K")).trim(), rta: num(cell(rows, 2, COL("D"))), accounts: accts, groups, cats };
    } else {
      const cats: Record<string, { assigned: number | null; activity: number | null; available: number | null }> = {};
      for (let r = 5; r < rows.length; r++) {
        const cat = cell(rows, r, COL("D")).trim();
        const marker = cell(rows, r, COL("C")).trim();
        if (!cat || marker === "▾" || marker === "▸") continue;
        cats[cat] = { assigned: num(cell(rows, r, COL("F"))), activity: num(cell(rows, r, COL("G"))), available: num(cell(rows, r, COL("H"))) };
      }
      history[name] = { cats };
    }
  }
  const recurring = sheets["Recurring"]?.slice(1).filter((r) => r[0]?.trim()).map((r) => r.slice(0, 8));
  const moves = sheets["Money moves"]?.slice(1).filter((r) => r.slice(0, 6).some((x) => x?.trim())).map((r) => r.slice(0, 6));
  // Pinned categories: the labelled block in column AE (names listed under the label, in dropdown order)
  const pinned: string[] = [];
  for (let r = 0; r < lg.length; r++) {
    if (cell(lg, r, COL("AE")).trim().startsWith("Pinned categories")) {
      for (let k = r + 1; k < Math.min(lg.length, r + 20); k++) {
        const v = cell(lg, k, COL("AE")).trim();
        if (v.startsWith("Dropdown order")) break;
        if (v) pinned.push(v);
      }
      break;
    }
  }
  const classic = sheets["Classic"] ? parseClassic(sheets["Classic"]) : undefined;
  return { accounts, first_month, current_month, ledger, months, history, recurring, moves, pinned, classic };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 2026" -> "2026-11-01" */
export function monthLabelToKey(s: string): ISODate | null {
  const m = s.trim().match(/^([A-Za-z]{3})\w* (\d{4})$/);
  if (!m) return null;
  const i = MON.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase());
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}-01`;
}

/** The Classic tab: mapping tables (by label, since rows shift), the income table and the six line boxes. */
export function parseClassic(cv: string[][]): SheetClassic {
  const find = (text: string, exact = true): [r: number, c: number] | null => {
    for (let r = 0; r < cv.length; r++) for (let c = 0; c < (cv[r]?.length ?? 0); c++) {
      const v = cell(cv, r, c).trim();
      if (exact ? v === text : v.includes(text)) return [r, c];
    }
    return null;
  };
  const below = (at: [number, number] | null, width: number, stopBlank = true): string[][] => {
    const out: string[][] = [];
    if (!at) return out;
    for (let r = at[0] + 1; r < cv.length; r++) {
      const row = Array.from({ length: width }, (_, k) => cell(cv, r, at[1] + k).trim());
      if (!row[0]) { if (stopBlank) break; else continue; }
      out.push(row);
    }
    return out;
  };
  const mapAt = find("Our category"), sideAt = find("Account -> side", false);
  const mapping: [string, string][] = [];
  if (mapAt) for (let r = mapAt[0] + 1; r < (sideAt ? sideAt[0] : cv.length); r++) {
    const a = cell(cv, r, mapAt[1]).trim(), b = cell(cv, r, mapAt[1] + 1).trim();
    if (a && b) mapping.push([a, b]); // blank rows inside the table are fine
  }
  const sides = below(sideAt, 2).map((r) => [r[0]!, r[1]!] as [string, string]);
  const keywords = below(find("Payee words that mean Internet", false), 1).map((r) => r[0]!);
  const income: SheetClassic["income"] = {};
  const inc = find("David budget");
  if (inc) for (const r of below([inc[0], inc[1] - 1], 5)) {
    const k = monthLabelToKey(r[0]!);
    if (k && (num(r[1]) !== null || num(r[2]) !== null || num(r[3]) !== null || num(r[4]) !== null)) income[k] = { D: [num(r[1]) ?? 0, num(r[2]) ?? 0], E: [num(r[3]) ?? 0, num(r[4]) ?? 0] };
  }
  const monthAt = find("Month");
  const month = (monthAt && monthLabelToKey(cell(cv, monthAt[0], monthAt[1] + 1))) ?? Object.keys(income)[0] ?? "2026-11-01";
  // the six boxes: header row holds "Budget"/"Actual" pairs; each box is (label col, budget col, actual col)
  const layout: SheetClassic["layout"] = [];
  const hdr = find("Recurring Shared Expenses");
  if (hdr) {
    const hr = hdr[0];
    const boxes: { label: string; column: "shared" | "D" | "E"; section: "recurring" | "variable" }[] = [
      { label: "Recurring Shared Expenses", column: "shared", section: "recurring" }, { label: "Variable Shared Expenses", column: "shared", section: "variable" },
    ];
    // David's and Elizabeth's boxes are both titled "Recurring Expenses" / "Variable Expenses": take them left to right
    let seenRec = 0, seenVar = 0;
    for (let c = 0; c < (cv[hr]?.length ?? 0); c++) {
      const v = cell(cv, hr, c).trim();
      if (v === "Recurring Expenses") boxes.push({ label: `#${c}`, column: seenRec++ === 0 ? "D" : "E", section: "recurring" });
      if (v === "Variable Expenses") boxes.push({ label: `#${c}`, column: seenVar++ === 0 ? "D" : "E", section: "variable" });
    }
    for (const b of boxes) {
      const c0 = b.label.startsWith("#") ? Number(b.label.slice(1)) : (find(b.label)?.[1] ?? -1);
      if (c0 < 0) continue;
      let bc = c0 + 1; while (bc < c0 + 4 && cell(cv, hr, bc).trim() !== "Budget") bc++;
      for (let r = hr + 1; r < hr + 14; r++) {
        const name = cell(cv, r, c0).trim();
        if (!name || name === "Total" || name === "Half") break;
        layout.push({ name, column: b.column, section: b.section, budget: num(cell(cv, r, bc)) ?? 0, actual: num(cell(cv, r, bc + 1)) ?? 0 });
      }
    }
  }
  // the tab's own summary figures, left to right (David's before Elizabeth's): "<label> #k budget|actual"
  const totals: Record<string, number> = {};
  const LABELS = ["Total", "Half", "Total variable expenses", "Total recurring expenses", "Total recurring + variable", "Income", "Savings so far", "Projected Savings (month end)", "+ Retirement & 529 contributions", "Total put away", "Weekly budget", "Total spent", "Total remaining", "Projected remaining at end of month"];
  const counts: Record<string, number> = {};
  for (let r = 0; r < Math.min(cv.length, 30); r++) for (let c = 0; c < 26; c++) {
    const v = cell(cv, r, c).trim();
    if (!LABELS.includes(v)) continue;
    const k = counts[v] = (counts[v] ?? 0) + 1;
    const nums: number[] = [];
    for (let cc = c + 1; cc <= c + 3 && nums.length < 2; cc++) { const n = num(cell(cv, r, cc)); if (n !== null) nums.push(n); }
    if (nums.length) totals[`${v} #${k} budget`] = nums[0]!;
    if (nums.length > 1) totals[`${v} #${k} actual`] = nums[1]!;
  }
  return { month, mapping, sides, keywords, income, layout, totals };
}
