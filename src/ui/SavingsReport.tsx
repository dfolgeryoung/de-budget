import { useEffect, useState } from "react";
import { api } from "./api";
import { formatMoney } from "../budget/money";
import type { SavingsPayload } from "../server/reports";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const whole = (c: number) => (c < 0 ? "−" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");
const signed = (c: number) => (c < 0 ? "−" : "+") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");

/**
 * Savings month by month, in the Classic view's terms: put away = income − spending (contributions left out of
 * spending), leftover = put away − contributions. Household from the ledger; per person from Classic's split.
 */
export function SavingsReport({ refreshKey, phone }: { refreshKey: number; phone: boolean }) {
  const [d, setD] = useState<SavingsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<"all" | "D" | "E">("all");
  useEffect(() => { api<SavingsPayload>("/reports/savings").then(setD).catch((e) => setErr(String(e))); }, [refreshKey]);
  if (err) return <p className="text-sm" style={{ color: "var(--red-text)" }}>{err}</p>;
  if (!d) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;

  const rows = d.months.map((m) => {
    if (who === "all") return { month: m.month, partial: m.partial, income: m.income, spending: m.spending, contributions: m.contributions, putAway: m.putAway, leftover: m.leftover, typed: true };
    const p = d.byPerson[m.month]?.[who];
    return { month: m.month, partial: m.partial, income: p?.income ?? 0, spending: p?.spending ?? 0, contributions: p?.contributions ?? 0, putAway: p?.putAway ?? 0, leftover: p?.leftover ?? 0, typed: p?.incomeTyped ?? false };
  });
  let run = 0; const withRun = rows.map((r) => ({ ...r, running: (run += r.putAway) }));
  const full = withRun.filter((r) => !r.partial);
  const avg = full.length ? Math.round(full.reduce((s, r) => s + r.putAway, 0) / full.length) : 0;
  const total = withRun.reduce((s, r) => s + r.putAway, 0);
  const contribTotal = withRun.reduce((s, r) => s + r.contributions, 0);
  const scale = Math.max(1, ...withRun.map((r) => Math.max(r.income, r.spending + r.contributions)));
  const cur = withRun[withRun.length - 1];
  const tile = (l: string, v: string, sub: string, color?: string) => (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{l}</div>
      <div className="text-[22px] font-bold tabular-nums leading-tight" style={{ color }}>{v}</div>
      <div className="text-[12px]" style={{ color: "var(--muted)" }}>{sub}</div>
    </div>
  );
  const name = who === "all" ? "Household" : d.people[who];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div role="group" aria-label="Whose savings" className="flex gap-0.5 rounded-[10px] p-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {([["all", "Household"], ["D", d.people.D], ["E", d.people.E]] as const).map(([k, l]) => <button key={k} onClick={() => setWho(k)} aria-pressed={who === k} className="rounded-lg px-3 text-[13px] font-semibold" style={{ height: 30, background: who === k ? "var(--selected)" : "transparent" }}>{l}</button>)}
        </div>
        <div className="text-[12px]" style={{ color: "var(--muted)" }}>{who === "all" ? "Income is what landed in Ready to Assign; spending is from the ledger." : `Classic's split: ${name}'s own lines plus half of shared; income as typed in Classic.`}</div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: phone ? "1fr 1fr" : "repeat(4, 1fr)" }}>
        {tile(cur?.partial ? "Put away so far" : "Put away", signed(cur?.putAway ?? 0), `${cur ? label(cur.month) : ""} · income − spending`, (cur?.putAway ?? 0) >= 0 ? "var(--green-text)" : "var(--neg)")}
        {tile("Contributions", whole(cur?.contributions ?? 0), "retirement & 529s this month")}
        {tile("Average month", signed(avg), full.length ? `over ${full.length} full ${full.length === 1 ? "month" : "months"}` : "no full month yet")}
        {tile("Since the start", signed(total), `${whole(contribTotal)} of it in contributions`, total >= 0 ? "var(--green-text)" : "var(--neg)")}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-2.5 text-[12px]" style={{ color: "var(--muted)", borderBottom: "1px solid var(--border-soft)" }}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: "var(--green-solid)" }} />income
          <span className="inline-block w-2.5 h-2.5 rounded-sm ml-3 mr-1 align-middle" style={{ background: "var(--ink)" }} />spending
          <span className="inline-block w-2.5 h-2.5 rounded-sm ml-3 mr-1 align-middle" style={{ background: "var(--hue-4)" }} />contributions
        </div>
        <div className={phone ? "overflow-x-auto" : ""}>
          <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: phone ? 560 : undefined }}>
            <thead>
              <tr style={{ color: "var(--muted)" }}>
                {["Month", "", "Income", "Spending", "Contributions", "Put away", "Leftover", "Running"].map((h, i) => <th key={i} className={"px-3 py-2 font-semibold text-[11px] uppercase tracking-wider " + (i <= 1 ? "text-left" : "text-right")} style={{ borderBottom: "1px solid var(--border-soft)", width: i === 1 ? (phone ? 150 : "28%") : undefined }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {withRun.map((r) => (
                <tr key={r.month} style={{ borderBottom: "1px solid var(--border-soft)", opacity: r.partial ? 0.85 : 1 }}>
                  <td className="px-3 py-2 align-middle whitespace-nowrap">
                    <div className="font-semibold">{label(r.month)}{r.partial ? <span className="font-normal text-[11px]" style={{ color: "var(--muted)" }}> so far</span> : ""}</div>
                    {!r.typed && who !== "all" && <div className="text-[10px]" style={{ color: "var(--yellow-text)" }}>income not typed in Classic — using its budget</div>}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-col gap-1">
                      <div className="h-3 rounded" style={{ width: `${(r.income / scale) * 100}%`, background: "var(--green-solid)" }} title={`Income ${formatMoney(r.income)}`} />
                      <div className="h-3 flex" style={{ width: `${((r.spending + r.contributions) / scale) * 100}%` }}>
                        <div className="rounded-l" style={{ flex: `${r.spending} 1 0`, background: "var(--ink)" }} title={`Spending ${formatMoney(r.spending)}`} />
                        {r.contributions > 0 && <div className="rounded-r" style={{ flex: `${r.contributions} 1 0`, minWidth: 8, background: "var(--hue-4)", boxShadow: "inset 0 0 0 1px var(--card)" }} title={`Contributions ${formatMoney(r.contributions)}`} />}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums align-top">{whole(r.income)}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top">{whole(r.spending)}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top">{whole(r.contributions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top font-semibold" style={{ color: r.putAway >= 0 ? "var(--green-text)" : "var(--neg)" }}>{signed(r.putAway)}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top" style={{ color: r.leftover >= 0 ? undefined : "var(--neg)" }}>{signed(r.leftover)}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top font-semibold">{signed(r.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[12px] flex flex-col gap-1" style={{ color: "var(--muted)", borderTop: "1px solid var(--border-soft)" }}>
          <div><strong>Put away</strong> = income − spending, where spending leaves out retirement and 529 lines. It's Classic's "put away". <strong>Leftover</strong> = put away − contributions: Classic's "savings so far" — what's still unassigned or sitting in categories after the contributions went out.</div>
          <div>Contribution lines are the categories whose names mention retirement, 529, 401(k), IRA, pension or HSA{cur?.partial && d.months[d.months.length - 1]!.contributionLines.length ? `: ${d.months[d.months.length - 1]!.contributionLines.map((l) => l.name).join(", ")}` : ""}.</div>
        </div>
      </div>
    </div>
  );
}

/** Month rows as stacked bars: income over spending + contributions, with put away at the right. Shared with Home. */
export function SavingsBars({ rows }: { rows: { month: string; partial: boolean; income: number; spending: number; contributions: number; putAway: number }[] }) {
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.income, r.spending + r.contributions)));
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] flex gap-3" style={{ color: "var(--muted)" }}>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: "var(--green-solid)" }} />income</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: "var(--ink)" }} />spending</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: "var(--hue-4)" }} />contributions</span>
      </div>
      {rows.map((r) => (
        <div key={r.month} className="grid items-center gap-3" style={{ gridTemplateColumns: "72px minmax(0,1fr) 80px" }}>
          <div className="text-[13px] font-semibold leading-tight">{label(r.month)}{r.partial && <div className="text-[10px] font-normal" style={{ color: "var(--muted)" }}>so far</div>}</div>
          <div className="flex flex-col gap-1">
            <div className="h-3 rounded" style={{ width: `${(r.income / scale) * 100}%`, background: "var(--green-solid)" }} title={`Income ${formatMoney(r.income)}`} />
            <div className="h-3 flex" style={{ width: `${((r.spending + r.contributions) / scale) * 100}%` }}>
              <div className="rounded-l" style={{ flex: `${r.spending} 1 0`, background: "var(--ink)" }} title={`Spending ${formatMoney(r.spending)}`} />
              {r.contributions > 0 && <div className="rounded-r" style={{ flex: `${r.contributions} 1 0`, minWidth: 8, background: "var(--hue-4)", boxShadow: "inset 0 0 0 1px var(--card)" }} title={`Contributions ${formatMoney(r.contributions)}`} />}
            </div>
          </div>
          <div className="text-right text-[13px] font-semibold tabular-nums" style={{ color: r.putAway >= 0 ? "var(--green-text)" : "var(--neg)" }}>{signed(r.putAway)}</div>
        </div>
      ))}
    </div>
  );
}
