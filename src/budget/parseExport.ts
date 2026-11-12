/**
 * Parse the Google Sheets text export of the budget ("## Sheet name: X" blocks of CSV) into
 * the SheetState shape. A port of extract_state.py so the app can take the raw export directly.
 */
import type { SheetState, SheetMonth } from "./fromState.js";
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
        if (cur) groups[groups.length - 1]![1].push(cat);
        cats[cat] = {
          assigned: num(cell(rows, r, COL("F"))), goal_type: cell(rows, r, COL("Q")).trim(), goal_amount: num(cell(rows, r, COL("R"))),
          freq: num(cell(rows, r, COL("T"))), goal_date: dt(cell(rows, r, COL("S"))),
          activity: num(cell(rows, r, COL("G"))), available: num(cell(rows, r, COL("H"))),
          group: cell(rows, r, COL("AA")).trim().replace(/^[▾▸]\s*/, ""),
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
  return { accounts, first_month, current_month, ledger, months, history, recurring, moves };
}
