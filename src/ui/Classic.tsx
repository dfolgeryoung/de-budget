import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { formatMoney, parseMoney } from "../budget/money";
import { addMonths } from "../budget/dates";
import type { ClassicPayload } from "../server/classic";
import type { ClassicLine, ClassicColumn } from "../budget/classic";
import { Chevron } from "./icons";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { monthLabel } from "./Budget";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const COLS: { id: ClassicColumn; label: string; tone: string }[] = [{ id: "shared", label: "Shared", tone: "shared" }, { id: "D", label: "David", tone: "david" }, { id: "E", label: "Elizabeth", tone: "eliz" }];
const tone = (t: string) => ({ head: `var(--classic-${t})`, box: `var(--classic-${t}-2)`, total: `var(--classic-${t}-3)`, soft: `var(--classic-${t}-4)`, dark: `var(--classic-${t}-dark)` });
const GRID = "minmax(0,1fr) 84px 84px";
const LIST = new Set(["Misc shared", "Groceries", "Gas", "Fun Money"]);

export function Classic({ refreshKey, openEntry }: { refreshKey: number; openEntry?: () => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<ClassicPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const [col, setCol] = useState<ClassicColumn>("shared");
  const [openMisc, setOpenMisc] = useState(false);
  const toast = useToast();
  const isPhone = typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;
  const load = () => { setErr(null); api<ClassicPayload>(month ? `/classic/${month}` : "/classic").then(setData).catch((e) => setErr(String(e))); };
  useEffect(load, [month, refreshKey]);

  async function save(owner: "D" | "E" | "shared", body: { income?: number; incomeActual?: number; typed?: Record<string, number> }) {
    try { await api(`/classic/${data!.month}`, { method: "PUT", json: { owner, ...body } }); load(); toast("Saved"); } catch (e) { toast(`Not saved: ${(e as Error).message}`); }
  }

  if (err) return <p className="text-sm" style={{ color: "var(--red-text)" }}>{err}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!data.layout.length) return <div className="rounded-xl p-6 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>Classic needs the spreadsheet import (it brings the mapping tables along). Import under <a href="#settings" style={{ color: "var(--accent-text)", fontWeight: 600 }}>Settings</a>.</div>;

  const lines = (c: ClassicColumn, s: "recurring" | "variable") => data.lines.filter((l) => l.column === c && l.section === s);

  const Row = ({ label, budget, actual, bold, bg, onBudget, children }: { label: ReactNode; budget?: number | null; actual?: number | null; bold?: boolean; bg?: string; onBudget?: (v: number) => void; children?: ReactNode }) => (
    <div className="grid items-center text-[13px]" style={{ gridTemplateColumns: GRID, padding: bold ? "9px 14px" : "8px 14px", borderTop: "1px solid var(--border-soft)", fontWeight: bold ? 700 : undefined, background: bg, color: bg ? "#1A1D23" : undefined }}>
      <span className="min-w-0 truncate flex items-center gap-2">{label}{children}</span>
      <span className="text-right">{budget == null ? "" : onBudget ? <Editable value={budget} onSave={onBudget} muted={!bold} /> : <span style={{ color: bold ? undefined : "var(--muted)" }}>{formatMoney(budget)}</span>}</span>
      <span className="text-right" style={{ color: actual === 0 ? (bg ? "#6B7684" : "var(--faint)") : undefined }}>{actual == null ? "" : actual === 0 ? "—" : formatMoney(actual)}</span>
    </div>
  );

  const Box = ({ c, section, title }: { c: ClassicColumn; section: "recurring" | "variable"; title: string }) => {
    const t = tone(COLS.find((x) => x.id === c)!.tone);
    const ls = lines(c, section);
    const tot = data.columns[c][section];
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: `1px solid ${t.box}` }}>
        <div className="grid text-[11px] font-semibold uppercase" style={{ gridTemplateColumns: GRID, padding: "9px 14px", background: t.box, color: "#1A1D23", letterSpacing: "0.06em" }}><span>{title}</span><span className="text-right">Budget</span><span className="text-right">Actual</span></div>
        {ls.map((l) => (
          <div key={l.key}>
            <Row label={<button className="text-left font-semibold truncate" onClick={() => l.name === "Misc shared" && setOpenMisc((v) => !v)} style={{ fontWeight: l.section === "variable" && LIST.has(l.name) ? 600 : 400, cursor: l.name === "Misc shared" ? "pointer" : "default" }}>{l.name}{l.name === "Misc shared" && <Chevron dir={openMisc ? "up" : "down"} size={11} className="inline ml-1.5" style={{ verticalAlign: -1 }} />}</button>}
              budget={l.budget} actual={l.actual} onBudget={l.typed ? (v) => save(l.column, { typed: { [l.key]: v } }) : undefined} />
            {l.name === "Misc shared" && openMisc && (
              <div className="flex flex-col gap-0.5 text-xs" style={{ padding: "2px 14px 8px 22px", color: "var(--text-2)", background: "var(--card-alt)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wider pb-1" style={{ color: "var(--muted)" }}>Budget = needed this month across these categories</div>
                {l.categories.sort((a, b) => b.needed - a.needed).map((x) => <div key={x.id} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span>{formatMoney(x.needed)}</span></div>)}
              </div>
            )}
            {l.section === "variable" && LIST.has(l.name) && <LineList l={l} t={t} />}
          </div>
        ))}
        <Row label="Total" budget={tot.budget} actual={tot.actual} bold bg={t.total} />
        {c === "shared" && <Row label="Half" budget={Math.round(tot.budget / 2)} actual={Math.round(tot.actual / 2)} bold bg={t.soft} />}
      </div>
    );
  };

  const Summary = ({ p }: { p: "D" | "E" }) => {
    const t = tone(p === "D" ? "david" : "eliz");
    const s = data.people[p];
    const line = (label: ReactNode, budget: ReactNode, actual: ReactNode, opts: { bold?: boolean; color?: string; bg?: string } = {}) => (
      <div className="grid items-center text-[13px]" style={{ gridTemplateColumns: GRID, padding: "7px 14px", borderTop: "1px solid var(--border-soft)", fontWeight: opts.bold ? 700 : undefined, color: opts.bg ? "#1A1D23" : opts.color, background: opts.bg }}>
        <span style={{ color: opts.bg ? "#1A1D23" : opts.color ?? (opts.bold ? undefined : "var(--muted)") }}>{label}</span><span className="text-right" style={{ color: opts.bold ? undefined : "var(--muted)" }}>{budget}</span><span className="text-right" style={{ color: opts.bg ? "#1A1D23" : undefined }}>{actual}</span>
      </div>
    );
    return (
      <div className="rounded-xl overflow-hidden text-[13px]" style={{ background: "var(--card)", border: `1px solid ${t.box}` }}>
        <div className="grid text-[11px] font-semibold uppercase" style={{ gridTemplateColumns: GRID, padding: "9px 14px", background: t.box, color: "#1A1D23", letterSpacing: "0.06em" }}><span>Month</span><span className="text-right">Budget</span><span className="text-right">Actual</span></div>
        {line("Income", <Editable value={s.incomeBudget} onSave={(v) => save(p, { income: v })} muted />, <Editable value={s.incomeActual} onSave={(v) => save(p, { incomeActual: v })} placeholder="type…" />)}
        {line("Share of shared costs (½)", formatMoney(s.shareBudget), formatMoney(s.shareActual))}
        {line("Total recurring + variable", formatMoney(s.totalBudget), formatMoney(s.totalActual))}
        {line("Savings so far", formatMoney(s.savingsBudget), <span style={{ color: s.savingsActual < 0 ? "var(--red-text)" : "var(--green-text)", fontWeight: 600 }}>{formatMoney(s.savingsActual)}</span>)}
        {line(<span className="inline-flex items-center gap-1.5">Projected savings<button aria-label="How the projection works" onClick={() => setExplain(true)} className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold" style={{ border: "1.5px solid currentColor" }}>i</button></span>, "", <span style={{ color: s.projectedSavings < 0 ? "var(--red-text)" : "var(--green-text)" }}>{formatMoney(s.projectedSavings)}</span>, { bold: true, color: t.dark })}
        {line("Retirement + 529 contributions", "", formatMoney(s.contributions))}
        {line("Total put away", "", <span style={{ color: s.putAway < 0 ? "#8c1d18" : "#1A1D23" }}>{formatMoney(s.putAway)}</span>, { bold: true, bg: t.soft })}
      </div>
    );
  };

  const Column = ({ c }: { c: ClassicColumn }) => {
    const meta = COLS.find((x) => x.id === c)!; const t = tone(meta.tone);
    return (
      <section aria-label={meta.label} className="flex flex-col gap-3 min-w-0">
        {!isPhone && <h2 className="m-0 text-[15px] font-bold text-white rounded-[10px]" style={{ background: t.head, padding: "9px 14px" }}>{meta.label}</h2>}
        {isPhone && c !== "shared" && (() => { const s = data.people[c]; return (
          <div className="rounded-xl text-[13px] flex flex-col" style={{ background: "var(--card)", border: `1px solid ${t.box}`, padding: "6px 14px" }}>
            <div className="flex justify-between py-1.5"><span style={{ color: "var(--muted)" }}>Income</span><span>{formatMoney(s.incomeActual || s.incomeBudget)}</span></div>
            <div className="flex justify-between py-1.5" style={{ borderTop: "1px solid var(--border-soft)" }}><span style={{ color: "var(--muted)" }}>Spent so far (incl. ½ shared)</span><span>{formatMoney(s.totalActual)}</span></div>
            <div className="flex justify-between py-1.5 font-semibold" style={{ borderTop: "1px solid var(--border-soft)", color: t.dark }}><span className="inline-flex items-center gap-1.5">Projected savings<button aria-label="How the projection works" onClick={() => setExplain(true)} className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold" style={{ border: "1.5px solid currentColor" }}>i</button></span><span style={{ color: s.projectedSavings < 0 ? "var(--red-text)" : "var(--green-text)" }}>{formatMoney(s.projectedSavings)}</span></div>
          </div>
        ); })()}
        <Box c={c} section="recurring" title={isPhone ? `${meta.label} Recurring` : "Recurring"} />
        <Box c={c} section="variable" title={isPhone ? `${meta.label} Variable` : "Variable"} />
        {c !== "shared" && <Summary p={c} />}
      </section>
    );
  };

  const nav = (
    <div className="flex items-center gap-2">
      <button aria-label="Previous month" onClick={() => setMonth(addMonths(data.month, -1))} className={isPhone ? "w-11 h-11 rounded-full inline-flex items-center justify-center" : "w-9 h-9 rounded-full inline-flex items-center justify-center"} style={isPhone ? { background: "rgba(255,255,255,0.12)" } : { border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="left" size={isPhone ? 16 : 14} /></button>
      <h1 className={isPhone ? "text-lg font-semibold flex-1 text-center" : "text-xl font-bold"}>Classic · {monthLabel(data.month)}</h1>
      <button aria-label="Next month" onClick={() => setMonth(addMonths(data.month, 1))} className={isPhone ? "w-11 h-11 rounded-full inline-flex items-center justify-center" : "w-9 h-9 rounded-full inline-flex items-center justify-center"} style={isPhone ? { background: "rgba(255,255,255,0.12)" } : { border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="right" size={isPhone ? 16 : 14} /></button>
    </div>
  );

  const explainPanel = explain && (
    <Sheet onClose={() => setExplain(false)}>
      <Explain data={data} />
    </Sheet>
  );

  if (isPhone) {
    return (
      <div className="flex flex-col -mx-4" style={{ gap: 10 }}>
        <div className="px-5 pb-3.5 flex flex-col" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))", gap: 12 }}>
          {nav}
          <div role="group" aria-label="Column" className="flex rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.12)" }}>
            {COLS.map((c) => <button key={c.id} onClick={() => setCol(c.id)} className="flex-1 rounded-full text-[13px] font-semibold" style={{ height: 32, background: col === c.id ? "#fff" : "transparent", color: col === c.id ? "var(--rail)" : "#fff" }}>{c.label}</button>)}
          </div>
        </div>
        {data.check && !data.check.ok && <div className="mx-3 rounded-xl p-3 text-xs" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>Differs from the spreadsheet's Classic tab in {data.check.diffs.length} place{data.check.diffs.length === 1 ? "" : "s"}.</div>}
        <div className="px-3"><Column c={col} /></div>
        {explainPanel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {nav}
        <div className="flex items-center gap-2">
          <button onClick={() => setExplain(true)} className="rounded-lg px-3 h-9 text-[13px] font-medium" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>How the projection works</button>
          {openEntry && <button onClick={openEntry} className="rounded-lg px-3 h-9 text-[13px] font-semibold" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ Add entry</button>}
        </div>
      </div>
      {data.check && (
        <div className="rounded-xl p-3 text-sm" style={{ background: data.check.ok ? "var(--green-bg)" : "var(--red-bg)", color: data.check.ok ? "var(--green-text)" : "var(--red-text)" }}>
          {data.check.ok ? <>✓ Every line matches the spreadsheet's Classic tab to the cent.</> : <><div className="font-semibold">Differs from the spreadsheet's Classic tab (expected while testing entries here):</div><ul className="list-disc ml-5">{data.check.diffs.slice(0, 8).map((d) => <li key={d}>{d}</li>)}{data.check.diffs.length > 8 && <li>… and {data.check.diffs.length - 8} more</li>}</ul></>}
        </div>
      )}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {COLS.map((c) => <Column key={c.id} c={c.id} />)}
      </div>
      <p className="text-xs" style={{ color: "var(--muted)" }}>Budget figures with a dotted underline are typed — click to change. Misc shared opens to its categories. Each line's column and box come from the category's Classic settings.</p>
      {explainPanel}
    </div>
  );
}

/** The transactions under a list line, oldest first, with a progress bar; Fun Money adds the weekly allowance. */
function LineList({ l, t }: { l: ClassicLine; t: ReturnType<typeof tone> }) {
  const pct = l.budget > 0 ? Math.min(100, (l.actual / l.budget) * 100) : 0;
  const over = l.budget > 0 && l.actual > l.budget;
  return (
    <>
      <div className="rounded-sm overflow-hidden" style={{ height: 4, margin: "0 14px 6px", background: "var(--track)" }}><div className="h-full" style={{ width: `${pct}%`, background: over ? "var(--red)" : t.head }} /></div>
      {l.entries.length > 0 && (
        <div className="flex flex-col text-xs" style={{ padding: "0 14px 8px 22px", gap: 3, color: "var(--text-2)" }}>
          {l.entries.map((e, i) => (
            <div key={e.id + i} className="flex justify-between gap-3"><span className="truncate">{short(e.date)} · {e.payee}{l.name === "Misc shared" ? ` · ${e.category}` : ""}{e.half ? " (½ shared)" : ""}</span><span className="shrink-0">{formatMoney(e.amount)}</span></div>
          ))}
        </div>
      )}
      {l.fun && (
        <div className="flex justify-between items-center rounded-lg text-xs" style={{ margin: "2px 14px 8px", padding: "7px 10px", background: "var(--card)", border: `1px dashed ${t.dark}` }}>
          <span style={{ color: "var(--text-2)" }}>Left <strong style={{ color: l.fun.remaining < 0 ? "var(--red-text)" : undefined }}>{formatMoney(l.fun.remaining)}</strong> · {l.fun.weeksLeft} weeks to go</span>
          <span className="font-bold" style={{ color: l.fun.perWeek < 0 ? "var(--red-text)" : t.dark }}>{formatMoney(l.fun.perWeek)} / week</span>
        </div>
      )}
    </>
  );
}

/** A typed figure: click to edit, Enter or blur saves, Escape cancels. */
function Editable({ value, onSave, muted, placeholder }: { value: number; onSave: (v: number) => void; muted?: boolean; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) return <button onClick={() => setText((value / 100).toFixed(2))} className="rounded px-1 -mr-1" title="Click to change" style={{ color: muted ? "var(--muted)" : undefined, textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{value === 0 && placeholder ? <span style={{ color: "var(--faint)" }}>{placeholder}</span> : formatMoney(value)}</button>;
  const commit = () => { const v = parseMoney(text); setText(null); if (v !== null && v !== value) onSave(v); };
  return <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(null); }} className="w-full text-right rounded px-1 outline-none text-[13px]" style={{ border: "1px solid var(--navy)", background: "var(--card)", height: 24 }} />;
}

/** The "Variable Projected Workbook" as a panel with the same figures. */
function Explain({ data }: { data: ClassicPayload }) {
  const list = data.lines.filter((l) => l.section === "variable" && LIST.has(l.name) && l.projection);
  const H = ({ children }: { children: ReactNode }) => <div className="text-[11px] font-semibold uppercase tracking-wider pt-3 pb-1" style={{ color: "var(--muted)" }}>{children}</div>;
  const R = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => <div className="flex justify-between text-[13px] py-1" style={{ borderTop: "1px solid var(--border-soft)", fontWeight: bold ? 700 : undefined }}><span style={{ color: bold ? undefined : "var(--text-2)" }}>{k}</span><span>{v}</span></div>;
  const person = (p: "D" | "E", name: string) => { const s = data.people[p]; return (
    <>
      <H>{name}</H>
      <R k="Projected variable (½ shared + own)" v={formatMoney(s.projectedVariable)} />
      <R k="Plus recurring (own + ½ shared, budget)" v={formatMoney(s.projectedVariable + s.recurringBudget)} />
      <R k={`Minus income (${s.incomeActualTyped ? "received" : "expected"})`} v={formatMoney(s.projectedSavings)} bold />
    </>
  ); };
  return (
    <div className="flex flex-col">
      <h2 className="font-bold text-base">How the projection works</h2>
      <p className="text-[13px] mt-1" style={{ color: "var(--text-2)" }}>{data.daysElapsed} days elapsed, {data.daysLeft} left. Each list below spends at its average daily rate for the days left; every other line counts its budget.</p>
      {list.map((l) => (
        <div key={l.key}>
          <H>{l.column === "shared" ? "" : l.column === "D" ? "David · " : "Elizabeth · "}{l.name}</H>
          <R k="Total remaining" v={formatMoney(l.projection!.remaining)} />
          <R k="Avg daily spend so far" v={formatMoney(l.projection!.avgDaily)} />
          <R k="Projected remaining" v={formatMoney(l.projection!.projectedRemaining)} bold />
        </div>
      ))}
      <H>Shared variable</H>
      <R k="Projected spend" v={formatMoney(data.sharedProjectedSpend)} />
      <R k="Half" v={formatMoney(Math.round(data.sharedProjectedSpend / 2))} bold />
      {person("D", "David")}
      {person("E", "Elizabeth")}
    </div>
  );
}
