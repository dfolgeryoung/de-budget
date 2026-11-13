import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { formatMoney } from "../budget/money";
import { addMonths } from "../budget/dates";
import type { ReportsPayload } from "../server/reports";
import type { ExplainBox, CategorySpend, ProjectedCategory } from "../budget/reports";
import { Chevron } from "./icons";
import { Sheet } from "./Sheet";
import { monthLabel } from "./Budget";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mon = (m: string) => MON[Number(m.slice(5, 7)) - 1]!;
type Tab = "month" | "trends" | "projection";
const TABS: { id: Tab; label: string }[] = [{ id: "month", label: "This month" }, { id: "trends", label: "Trends" }, { id: "projection", label: "Projection" }];
const WHO = { shared: { label: "Shared", color: "var(--classic-shared)" }, D: { label: "David", color: "var(--classic-david)" }, E: { label: "Elizabeth", color: "var(--classic-eliz)" } } as const;
const BAR = "var(--classic-shared-2)";
/** Whole dollars on the phone, cents on desktop. */
const money = (c: number, phone: boolean) => (phone ? (c < 0 ? "−" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US") : formatMoney(c));
const signed = (c: number, phone: boolean) => (c > 0 ? "+" : c < 0 ? "−" : "") + money(Math.abs(c), phone);

/** Jump to the ledger filtered to one category and month. */
export function goToTransactions(filter: { category?: string | null; month?: string | null }) {
  try { sessionStorage.setItem("txn-filter", JSON.stringify(filter)); } catch { /* private mode */ }
  location.hash = "transactions";
}

export function Reports({ refreshKey }: { refreshKey: number }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  const [explain, setExplain] = useState<ExplainBox | null>(null);
  const [showAll, setShowAll] = useState(false);
  const isPhone = typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;
  useEffect(() => { setErr(null); api<ReportsPayload>(month ? `/reports/${month}` : "/reports").then(setData).catch((e) => setErr(String(e))); }, [month, refreshKey]);

  if (err) return <p className="text-sm" style={{ color: "var(--red-text)" }}>{err}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  const d = data, tm = d.thisMonth, ph = isPhone;
  const people = { shared: "Shared", D: d.people.D, E: d.people.E };

  const Info = ({ box, light }: { box: ExplainBox; light?: boolean }) => (
    <button aria-label={`How "${box.title}" is worked out`} title="How this is worked out" onClick={() => setExplain(box)} className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold shrink-0 tb-btn" style={{ border: "1.5px solid currentColor", color: light ? "#fff" : "var(--muted)", opacity: light ? 0.8 : 1 }}>i</button>
  );

  const navBtn = (dir: "left" | "right") => (
    <button aria-label={dir === "left" ? "Previous month" : "Next month"} onClick={() => setMonth(addMonths(d.month, dir === "left" ? -1 : 1))} className={ph ? "w-11 h-11 rounded-full inline-flex items-center justify-center" : "w-9 h-9 rounded-full inline-flex items-center justify-center"} style={ph ? { background: "rgba(255,255,255,0.12)" } : { border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir={dir} size={ph ? 16 : 14} /></button>
  );
  const nav = <div className="flex items-center gap-2">{navBtn("left")}<h1 className={ph ? "text-lg font-semibold flex-1 text-center" : "text-xl font-bold"}>Reports · {monthLabel(d.month)}</h1>{navBtn("right")}</div>;
  const tabs = ph ? (
    <div role="group" aria-label="Report" className="flex rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.12)" }}>
      {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className="flex-1 rounded-full text-[13px] font-semibold" style={{ height: 32, background: tab === t.id ? "#fff" : "transparent", color: tab === t.id ? "var(--rail)" : "#fff" }}>{t.label}</button>)}
    </div>
  ) : (
    <div role="group" aria-label="Report" className="flex gap-0.5 rounded-[10px] p-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className="rounded-lg px-4 text-[13px] tb-btn" style={{ height: 32, background: tab === t.id ? "var(--navy)" : "transparent", color: tab === t.id ? "var(--navy-text)" : "var(--muted)", fontWeight: tab === t.id ? 600 : 500 }}>{t.label}</button>)}
    </div>
  );

  // ----- stat tiles
  const Tile = ({ label, value, sub, box, tone }: { label: string; value: ReactNode; sub: ReactNode; box?: ExplainBox; tone?: string }) => (
    <div className="rounded-xl flex flex-col min-w-0" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: ph ? "10px 12px" : "14px 16px", gap: 4 }}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider truncate" style={{ color: "var(--muted)" }}>{label}{box && !ph && <Info box={box} />}</span>
      <span className={ph ? "text-[20px] font-bold leading-tight" : "text-[26px] font-bold leading-tight"} style={{ color: tone }}>{value}</span>
      <span className="text-xs truncate" style={{ color: "var(--muted)" }}>{sub}</span>
    </div>
  );
  const diff = tm.onPace - tm.budgeted;
  const pctText = tm.vsLast.pct === null ? "—" : `${tm.vsLast.pct >= 0 ? "+" : "−"}${(Math.abs(tm.vsLast.pct) * 100).toFixed(1)}%`;
  const tiles = (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      <Tile label={ph ? "Spent" : "Spent so far"} value={money(tm.spent, ph)} sub={ph ? `of ${money(tm.budgeted, ph)}` : `of ${money(tm.budgeted, ph)} budgeted · day ${d.daysElapsed} of ${d.daysInMonth}`} box={tm.explain.spent} />
      <Tile label={ph ? "On pace" : "On pace to spend"} value={money(tm.onPace, ph)} sub={diff > 0 ? `${money(diff, ph)} over${ph ? "" : " budget"}` : `${money(-diff, ph)} under${ph ? "" : " budget"}`} box={tm.explain.onPace} tone={diff > 0 ? "var(--red-text)" : undefined} />
      <Tile label={ph ? `Vs ${mon(d.prevMonth)}` : `Vs ${mon(d.prevMonth)}, same day`} value={pctText} sub={ph ? "same day" : tm.vsLast.summary} box={tm.explain.vsLast} tone={tm.vsLast.pct !== null && tm.vsLast.pct > 0 ? "var(--red-text)" : tm.vsLast.pct !== null && tm.vsLast.pct < 0 ? "var(--green-text)" : undefined} />
    </div>
  );
  // on the phone the info dots live under the tiles, one row
  const phoneInfo = ph && <div className="flex gap-3 px-1 -mt-1 text-[11px] flex-wrap" style={{ color: "var(--muted)" }}><span className="font-semibold">Day {d.daysElapsed} of {d.daysInMonth}</span>{[tm.explain.spent, tm.explain.onPace, tm.explain.vsLast].map((b) => <button key={b.title} onClick={() => setExplain(b)} className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2">{b.title}</button>)}</div>;

  const Card = ({ title, sub, box, children, className = "" }: { title: string; sub?: string; box?: ExplainBox; children: ReactNode; className?: string }) => (
    <section aria-label={title} className={"rounded-xl flex flex-col " + className} style={{ background: "var(--card)", border: "1px solid var(--border)", padding: ph ? "12px 12px" : "14px 16px", gap: 10 }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="m-0 text-[14px] font-bold inline-flex items-center gap-1.5">{title}{box && <Info box={box} />}</h2>
        {sub && <span className="text-[11px]" style={{ color: "var(--muted)" }}>{sub}</span>}
      </div>
      {children}
    </section>
  );

  // ----- spend by category
  const cats = showAll ? tm.byCategory : tm.byCategory.slice(0, ph ? 6 : 9);
  const scale = Math.max(1, ...cats.map((c) => Math.max(c.spent, c.budget)));
  // each row is its own grid, so the amount column is sized once to the widest figure to keep every bar the same length
  const colFor = (labels: string[]) => `${Math.max(3, ...labels.map((l) => l.length)) * 7.4 + 4}px`;
  const catAmtCol = colFor(cats.map((c) => money(c.spent, ph)));
  const CatBar = ({ c }: { c: CategorySpend }) => {
    const w = Math.max(0, Math.min(100, (c.spent / scale) * 100)), tick = Math.min(100, (c.budget / scale) * 100);
    const over = c.budget > 0 && c.spent > c.budget;
    return (
      <button onClick={() => goToTransactions({ category: c.id, month: d.month })} title={`${c.name}: spent ${formatMoney(c.spent)} of ${formatMoney(c.budget)} budgeted — open its entries`} className={"row-hover grid items-center text-[13px] rounded-md text-left -mx-1 px-1 " + (ph ? "gap-2" : "gap-3")} style={{ gridTemplateColumns: ph ? `112px minmax(0,1fr) ${catAmtCol}` : "150px minmax(0,1fr) 80px", height: 28 }}>
        <span className="truncate">{c.emoji ? c.emoji + " " : ""}{c.name}</span>
        <span className="relative block rounded" style={{ height: 16, background: "var(--track)" }}>
          <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${w}%`, background: over ? "var(--red)" : BAR, transition: "width 400ms ease-out" }} />
          {c.budget > 0 && <span className="absolute" style={{ left: `calc(${tick}% - 1px)`, top: -3, width: 2, height: 22, background: "var(--text)" }} />}
        </span>
        <span className="text-right font-semibold tabular-nums">{money(c.spent, ph)}</span>
      </button>
    );
  };
  const spendCard = (
    <Card title="Spend by category" sub={ph ? "tick = budget · tap a bar" : "bar = spent · tick = budget · click a bar for its transactions"}>
      {cats.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Nothing spent yet.</p> : <div className="flex flex-col gap-1">{cats.map((c) => <CatBar key={c.id} c={c} />)}</div>}
      {tm.byCategory.length > cats.length ? <button onClick={() => setShowAll(true)} className="text-[13px] font-semibold text-left" style={{ color: "var(--accent-text)" }}>{ph ? `All ${tm.byCategory.length} categories ›` : `Show all ${tm.byCategory.length} categories ›`}</button>
        : showAll && tm.byCategory.length > 9 ? <button onClick={() => setShowAll(false)} className="text-[13px] font-semibold text-left" style={{ color: "var(--accent-text)" }}>Show fewer</button> : null}
    </Card>
  );

  // ----- who spent
  const total = tm.byOwner.reduce((s, o) => s + o.spent, 0);
  const donut = (() => {
    const r = 34, cx = 44, cy = 44, C = 2 * Math.PI * r;
    let off = 0;
    return (
      <svg aria-hidden="true" width={88} height={88} viewBox="0 0 88 88" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--track)" strokeWidth={14} />
        {total > 0 && tm.byOwner.filter((o) => o.spent > 0).map((o) => {
          const len = (o.spent / total) * C, el = <circle key={o.who} cx={cx} cy={cy} r={r} fill="none" stroke={WHO[o.who].color} strokeWidth={14} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} />;
          off += len; return el;
        })}
      </svg>
    );
  })();
  const whoCard = (
    <Card title={ph ? "Who spent" : `Shared vs ${people.D} vs ${people.E}`} box={tm.explain.who}>
      <div className="flex items-center gap-4">
        {donut}
        <div className="flex-1 flex flex-col gap-1.5 text-[13px] min-w-0">
          {tm.byOwner.map((o) => (
            <div key={o.who} className="grid items-center gap-2" style={{ gridTemplateColumns: "10px minmax(0,1fr) auto 38px" }}>
              <span className="rounded-full" style={{ width: 10, height: 10, background: WHO[o.who].color }} /><span className="truncate">{people[o.who]}</span><span className="font-semibold tabular-nums">{money(o.spent, ph)}</span><span className="text-right" style={{ color: "var(--muted)" }}>{Math.round(o.share * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );

  // ----- movers and bills
  const moversCard = (
    <Card title={`Rose most vs ${mon(d.prevMonth)}`} sub={ph ? undefined : `same day (${d.daysElapsed}${d.daysElapsed === 1 ? "st" : d.daysElapsed === 2 ? "nd" : d.daysElapsed === 3 ? "rd" : "th"})`}>
      {tm.movers.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Nothing to compare yet.</p> : (
        <div className="flex flex-col gap-1 text-[13px]">
          {tm.movers.slice(0, ph ? 3 : 4).map((m) => <button key={m.id} onClick={() => goToTransactions({ category: m.id, month: d.month })} className="row-hover flex justify-between gap-3 rounded-md -mx-1 px-1 py-0.5 text-left"><span className="truncate">{m.emoji ? m.emoji + " " : ""}{m.name}</span><span className="font-semibold tabular-nums shrink-0" style={{ color: m.delta > 0 ? "var(--red-text)" : "var(--green-text)" }}>{signed(m.delta, false)}</span></button>)}
        </div>
      )}
    </Card>
  );
  const billsCard = (
    <Card title="Bills still to come">
      {tm.billsToCome.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Every recurring bill is in for {mon(d.month)}.</p> : (
        <div className="flex flex-col gap-1 text-[13px]">
          {tm.billsToCome.map((b) => <div key={b.id} className="flex justify-between gap-3"><span className="truncate" style={{ color: b.overdue ? "var(--yellow-text)" : undefined }}>{b.day ? `${mon(d.month)} ${b.day}` : "Sometime"} · {b.payee}{b.overdue ? " · not entered yet" : ""}</span><span className="tabular-nums shrink-0">{formatMoney(b.amount)}</span></div>)}
          <div className="flex justify-between gap-3 font-bold pt-1.5 mt-0.5" style={{ borderTop: "1px solid var(--border-soft)" }}><span>Total</span><span className="tabular-nums">{formatMoney(tm.billsTotal)}</span></div>
        </div>
      )}
    </Card>
  );

  // ----- trends
  const tr = d.trends;
  const trendsView = (() => {
    const max = Math.max(1, ...tr.months.flatMap((m) => [m.spent, m.income]));
    const H = ph ? 120 : 160, W = 100 / tr.months.length;
    return (
      <>
        <Card title="Spent vs income, by month" sub="current month to date" box={tr.explain}>
          <div className="flex items-end gap-2" style={{ height: H + 26 }}>
            {tr.months.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" style={{ width: `${W}%` }} title={`${monthLabel(m.month)}: spent ${formatMoney(m.spent)}, income ${formatMoney(m.income)}`}>
                <div className="flex items-end gap-[3px] w-full justify-center" style={{ height: H }}>
                  <span className="rounded-t" style={{ width: "38%", maxWidth: 28, height: `${Math.max(2, (m.spent / max) * H)}px`, background: m.month === d.month ? "var(--classic-shared)" : BAR, transition: "height 400ms ease-out" }} />
                  <span className="rounded-t" style={{ width: "38%", maxWidth: 28, height: `${Math.max(2, (m.income / max) * H)}px`, background: "var(--classic-david-2)", transition: "height 400ms ease-out" }} />
                </div>
                <span className="text-[11px] font-semibold" style={{ color: m.month === d.month ? "var(--text)" : "var(--muted)" }}>{mon(m.month)}{ph ? "" : ` ${m.month.slice(2, 4)}`}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-[11px]" style={{ color: "var(--muted)" }}><span className="inline-flex items-center gap-1.5"><span className="rounded-sm" style={{ width: 10, height: 10, background: BAR }} />Spent</span><span className="inline-flex items-center gap-1.5"><span className="rounded-sm" style={{ width: 10, height: 10, background: "var(--classic-david-2)" }} />Income to Ready to Assign</span></div>
          <div className="grid text-[12px] gap-x-2" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${tr.months.length}, minmax(0, 1fr))` }}>
            <span style={{ color: "var(--muted)" }} />{tr.months.map((m) => <span key={m.month} className="text-right font-semibold" style={{ color: "var(--muted)" }}>{mon(m.month)}</span>)}
            <span style={{ color: "var(--muted)" }}>Spent</span>{tr.months.map((m) => <span key={m.month} className="text-right tabular-nums">{money(m.spent, true)}</span>)}
            <span style={{ color: "var(--muted)" }}>Income</span>{tr.months.map((m) => <span key={m.month} className="text-right tabular-nums">{money(m.income, true)}</span>)}
            <span style={{ color: "var(--muted)" }}>Net</span>{tr.months.map((m) => <span key={m.month} className="text-right tabular-nums font-semibold" style={{ color: m.income - m.spent < 0 ? "var(--red-text)" : "var(--green-text)" }}>{signed(m.income - m.spent, true)}</span>)}
          </div>
        </Card>
        <Card title="Top categories over these months" sub="each cell is that month's spend">
          {tr.categories.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>No spending yet.</p> : (() => {
            const cmax = Math.max(1, ...tr.categories.flatMap((c) => c.perMonth));
            return (
              <div className="flex flex-col gap-1.5">
                {tr.categories.map((c) => (
                  <div key={c.id} className="grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: `${ph ? 110 : 150}px repeat(${tr.months.length}, minmax(0,1fr)) ${ph ? 62 : 80}px` }}>
                    <span className="truncate">{c.emoji ? c.emoji + " " : ""}{c.name}</span>
                    {c.perMonth.map((v, i) => (
                      <button key={i} onClick={() => goToTransactions({ category: c.id, month: tr.months[i]!.month })} title={`${monthLabel(tr.months[i]!.month)}: ${formatMoney(v)}`} className="relative rounded" style={{ height: 16, background: "var(--track)" }}>
                        <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${(v / cmax) * 100}%`, background: tr.months[i]!.month === d.month ? "var(--classic-shared)" : BAR }} />
                      </button>
                    ))}
                    <span className="text-right font-semibold tabular-nums">{money(c.total, ph)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>
        <Card title="Who spent, by month">
          <div className="flex flex-col gap-1.5">
            {tr.months.map((m) => { const t = m.byOwner.shared + m.byOwner.D + m.byOwner.E; return (
              <div key={m.month} className="grid items-center gap-2 text-[12px]" style={{ gridTemplateColumns: "48px minmax(0,1fr)" }}>
                <span className="font-semibold" style={{ color: "var(--muted)" }}>{mon(m.month)}</span>
                <div className="flex rounded overflow-hidden" style={{ height: 14, background: "var(--track)" }} title={`Shared ${formatMoney(m.byOwner.shared)} · ${people.D} ${formatMoney(m.byOwner.D)} · ${people.E} ${formatMoney(m.byOwner.E)}`}>
                  {(["shared", "D", "E"] as const).map((w) => t > 0 && m.byOwner[w] > 0 ? <span key={w} style={{ width: `${(m.byOwner[w] / t) * 100}%`, background: WHO[w].color }} /> : null)}
                </div>
              </div>
            ); })}
          </div>
          <div className="flex gap-4 text-[11px]" style={{ color: "var(--muted)" }}>{(["shared", "D", "E"] as const).map((w) => <span key={w} className="inline-flex items-center gap-1.5"><span className="rounded-sm" style={{ width: 10, height: 10, background: WHO[w].color }} />{people[w]}</span>)}</div>
        </Card>
      </>
    );
  })();

  // ----- projection
  const pr = d.projection;
  const projectionView = (() => {
    const short = pr.totalProjected - pr.totalBudgeted;
    const pmax = Math.max(1, ...pr.categories.map((c) => Math.max(c.projected, c.budget)));
    const projAmtCol = colFor(pr.categories.map((c) => money(c.projected, ph)));
    const PRow = ({ c }: { c: ProjectedCategory }) => (
      <button onClick={() => goToTransactions({ category: c.id, month: d.month })} className={"row-hover grid items-center text-[13px] rounded-md text-left -mx-1 px-1 " + (ph ? "gap-2" : "gap-3")} style={{ gridTemplateColumns: ph ? `112px minmax(0,1fr) ${projAmtCol}` : "150px minmax(0,1fr) 90px 90px", height: 28 }} title={`${c.name}: spent ${formatMoney(c.spent)} so far${c.billsLeft ? `, bills to come ${formatMoney(c.billsLeft)}` : ""}${c.how === "daily" ? `, about ${formatMoney(Math.round(c.avgDaily))} a day` : c.how === "one-off" ? ", one-off (not extrapolated)" : ""} → ${formatMoney(c.projected)} of ${formatMoney(c.available)} available`}>
        <span className="truncate">{c.emoji ? c.emoji + " " : ""}{c.name}{c.how === "one-off" && !ph && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--faint)" }}>one-off</span>}</span>
        <span className="relative block rounded" style={{ height: 16, background: "var(--track)" }}>
          <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${Math.min(100, (c.spent / pmax) * 100)}%`, background: c.over ? "var(--red)" : BAR }} />
          <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${Math.min(100, (c.projected / pmax) * 100)}%`, background: c.over ? "var(--red)" : BAR, opacity: 0.35 }} />
          {c.available > 0 && <span className="absolute" style={{ left: `calc(${Math.min(100, (c.available / pmax) * 100)}% - ${c.available >= pmax ? 2 : 1}px)`, top: -3, width: 2, height: 22, background: "var(--text)" }} />}
        </span>
        <span className="text-right font-semibold tabular-nums" style={{ color: c.over ? "var(--red-text)" : undefined }}>{money(c.projected, ph)}</span>
        {!ph && <span className="text-right tabular-nums" style={{ color: "var(--muted)" }}>{money(c.available, ph)}</span>}
      </button>
    );
    return (
      <>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Tile label={ph ? "Projected" : "Projected spend"} value={money(pr.totalProjected, ph)} sub={`by ${mon(d.month)} ${d.daysInMonth}`} box={pr.explain} />
          <Tile label="Budgeted" value={money(pr.totalBudgeted, ph)} sub={ph ? "assigned or goal" : "assigned, or what each goal needs"} />
          <Tile label={short > 0 ? "Over budget" : "Under budget"} value={money(Math.abs(short), ph)} sub={ph ? "if it holds" : "if spending holds its pace"} tone={short > 0 ? "var(--red-text)" : "var(--green-text)"} />
        </div>
        {ph && <div className="flex gap-3 px-1 -mt-1 text-[11px]" style={{ color: "var(--muted)" }}><button onClick={() => setExplain(pr.explain)} className="underline decoration-dotted underline-offset-2">How the projection works</button></div>}
        {pr.headingOver.length > 0 && (
          <div className="rounded-xl p-3 text-[13px]" style={{ background: "var(--yellow-row)", border: "1px solid var(--yellow-bg)", color: "var(--yellow-text)" }}>
            <strong>Heading over:</strong> {pr.headingOver.slice(0, 5).map((c) => `${c.name} by ${formatMoney(c.over)}`).join(", ")}{pr.headingOver.length > 5 ? ` and ${pr.headingOver.length - 5} more` : ""}.
          </div>
        )}
        <Card title="Where each category lands" sub={ph ? "solid = spent · faint = projected · tick = available" : "solid = spent so far · faint = projected by month end · tick = available (carry-over included) · one-offs are not extrapolated · click for its entries"}>
          {!ph && <div className="grid gap-3 text-[11px] font-semibold uppercase tracking-wider -mb-1" style={{ gridTemplateColumns: "150px minmax(0,1fr) 90px 90px", color: "var(--muted)" }}><span /><span /><span className="text-right">Projected</span><span className="text-right">Available</span></div>}
          <div className="flex flex-col gap-1">{pr.categories.map((c) => <PRow key={c.id} c={c} />)}</div>
        </Card>
      </>
    );
  })();

  const explainPanel = explain && <Sheet onClose={() => setExplain(null)}><ExplainPanel box={explain} /></Sheet>;

  const body = tab === "month" ? (
    ph ? <>{tiles}{phoneInfo}{spendCard}{whoCard}{moversCard}{billsCard}</> : (
      <>
        {tiles}
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
          {spendCard}
          <div className="flex flex-col gap-4">{whoCard}{moversCard}{billsCard}</div>
        </div>
      </>
    )
  ) : tab === "trends" ? trendsView : projectionView;

  if (ph) {
    return (
      <div className="flex flex-col -mx-4" style={{ gap: 10 }}>
        <div className="px-5 pb-3.5 flex flex-col" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))", gap: 12 }}>{nav}{tabs}</div>
        <div className="px-3 flex flex-col gap-3">{body}</div>
        {explainPanel}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{nav}{tabs}</div>
      {body}
      {explainPanel}
    </div>
  );
}

/** The arithmetic behind a figure: every operand on its own line, results shaded. */
function ExplainPanel({ box }: { box: ExplainBox }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-bold text-base m-0">{box.title}</h2>
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {box.rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: "18px minmax(0,1fr) auto", padding: r.result ? "8px 14px" : "6px 14px", borderTop: i ? "1px solid var(--border-soft)" : undefined, fontWeight: r.result ? 700 : undefined, background: r.result ? "var(--selected)" : undefined }}>
            <span className="text-center font-semibold" style={{ color: "var(--muted)" }}>{r.result ? "=" : r.op ?? ""}</span>
            <span className={r.sub ? "text-xs" : ""} style={{ color: r.result ? "var(--text)" : r.sub ? "var(--muted)" : "var(--text-2)" }}>{r.k}</span>
            <span className="text-right tabular-nums" style={{ color: r.result && typeof r.v === "number" && r.v < 0 ? "var(--red-text)" : undefined }}>{typeof r.v === "number" ? formatMoney(r.v) : r.v}</span>
          </div>
        ))}
      </div>
      {box.note && <p className="text-[13px] m-0" style={{ color: "var(--text-2)" }}>{box.note}</p>}
    </div>
  );
}
