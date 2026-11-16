/**
 * Home on a big screen: a greeting, the month in plain words, a row of headline tiles, then the cards —
 * what needs a decision first, then where the money went, then what's coming. Everything comes from the one
 * /home bundle the phone uses, so the two screens never disagree.
 */
import { useEffect, useState, type ReactNode } from "react";
import { api, apiCached, todayISO, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import { weeklyAllowance } from "../budget/engine";
import { narrative, savingFacts, savingNarrative, monthName } from "../budget/narrative";
import { useToast } from "./Toast";
import { DupPairRow } from "./Duplicates";
import { FlagSheet } from "./FlagSheet";
import { goToTransactions } from "./Reports";
import type { MonthPayload } from "../server/month";
import type { LedgerRow } from "../server/transactions";
import type { TrackedSummary } from "../server/tracked";
import type { UpcomingBill } from "../server/recurring";
import type { ReportsPayload } from "../server/reports";
import type { FlaggedEntry } from "../server/flags";
import type { DupPair } from "../server/duplicates";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const md = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const whole = (c: number) => (c < 0 ? "−" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");

type Pending = { id: string; date: string; accountId: string; payee: string | null; amount: number; categoryId: string | null };
type HomeData = { month: MonthPayload | null; recent: LedgerRow[]; pending: Pending[]; upcoming: UpcomingBill[]; tracked: TrackedSummary[]; report: ReportsPayload | null; flags?: FlaggedEntry[]; duplicates?: DupPair[] };

export function DesktopHome({ me, lists, refreshKey, goTransactions, openEdit }: { me: { id: string; name: string; initial?: string }; lists: Lists; refreshKey: number; goTransactions: (account: string | null) => void; openEdit?: (id: string) => void }) {
  const [d, setD] = useState<HomeData | null>(null);
  const [bump, setBump] = useState(0);
  const [flagOpen, setFlagOpen] = useState<FlaggedEntry | null>(null);
  const toast = useToast();
  useEffect(() => { apiCached<HomeData>("/home?report=1", setD).catch(() => { /* keep what's on screen */ }); }, [refreshKey, bump]);
  const refresh = () => { setBump((b) => b + 1); dispatchEvent(new Event("lists-changed")); };

  async function act(id: string, what: "confirm" | "skip", label: string) {
    try {
      if (what === "confirm") await api(`/transactions/${id}/confirm`, { method: "POST", json: {} }); else await api(`/transactions/${id}`, { method: "DELETE" });
      toast(what === "confirm" ? `Confirmed ${label}` : `Skipped ${label}`); refresh();
    } catch (e) { toast((e as Error).message); }
  }

  const first = me.name.split(" ")[0] ?? me.name;
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todayIso = todayISO();
  const dateLine = `${DAYS[now.getDay()]}, ${monthName(todayIso)} ${now.getDate()}`;

  if (!d || !d.month) return <div className="max-w-[1180px] mx-auto"><h1 className="text-[28px] font-bold m-0">{greet}, {first}.</h1><p style={{ color: "var(--muted)" }}>{dateLine} · loading the month…</p></div>;

  const m = d.month, r = d.report;
  const kinds = Object.fromEntries(Object.entries(m.categories).map(([id, c]) => [id, c.kind]));
  const catName = (id: string | null) => (id ? `${m.categories[id]?.emoji ?? ""} ${m.categories[id]?.name ?? ""}`.trim() : "Ready to Assign");
  const acctName = (id: string) => lists.accounts.find((a) => a.id === id)?.name ?? "";
  const facts = r ? savingFacts(r, m.view, kinds, m.daysOfBuffer) : null;
  const spendPara = r ? narrative(r, r.people, null) : [];
  const savePara = facts ? savingNarrative(facts) : [];
  const elapsedPct = r ? r.daysElapsed / r.daysInMonth : 0;
  const tm = r?.thisMonth;
  const paceDiff = tm ? tm.onPace - tm.budgeted : 0;

  // budget lines that need a look
  const cats = m.view.categories.filter((c) => !m.categories[c.categoryId]?.hidden);
  const overspent = cats.filter((c) => c.status === "overspent").sort((a, b) => a.available - b.available);
  const under = cats.filter((c) => c.status === "underfunded" || c.status === "not_enough").sort((a, b) => b.short - a.short);
  const goCategory = (id: string) => { try { sessionStorage.setItem("budget-select", id); } catch { /* private mode */ } location.hash = "budget"; };
  const openTracked = (id: string) => { try { sessionStorage.setItem("tracked-select", id); } catch { /* private mode */ } location.hash = "tracked"; };

  // fun money for both of you
  const funFor = (who: "D" | "E") => {
    const name = who === "E" ? "elizabeth fun" : "david fun";
    const id = Object.entries(m.categories).find(([, c]) => c.name.toLowerCase().includes(name))?.[0];
    const c = id ? m.view.categories.find((x) => x.categoryId === id) : undefined;
    return c ? { id: id!, who, person: r?.people[who] ?? (who === "D" ? "David" : "Elizabeth"), available: c.available, ...weeklyAllowance(c.available, todayIso) } : null;
  };
  const fun = [funFor("D"), funFor("E")].filter((x): x is NonNullable<typeof x> => !!x);

  const pending = d.pending, flags = d.flags ?? [], dupes = d.duplicates ?? [];
  const upcoming = d.upcoming, upcomingTotal = upcoming.reduce((s, b) => s + Math.min(0, b.amount), 0);
  const openTracked_ = d.tracked.filter((x) => !x.closed);
  const attention = pending.length + flags.length + dupes.length + overspent.length + under.length;
  const spendCats = (tm?.byCategory ?? []).filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 8);
  const spendScale = Math.max(1, ...spendCats.map((c) => Math.max(c.spent, c.budget)));
  const movers = (tm?.movers ?? []).filter((x) => Math.abs(x.delta) >= 2000).slice(0, 5);
  const owners = tm?.byOwner ?? [];
  const months = (r?.trends.months ?? []).slice(-6);
  const keptScale = Math.max(1, ...months.map((x) => Math.abs(x.income - x.spent)));
  const onBudget = m.accounts.filter((a) => a.onBudget);

  return (
    <div className="max-w-[1180px] mx-auto flex flex-col gap-5">
      {flagOpen && <FlagSheet entry={{ id: flagOpen.id, payee: flagOpen.payee, amount: flagOpen.amount, date: flagOpen.date, flagOpen: true }} meId={me.id} open onClose={() => setFlagOpen(null)} onChanged={refresh} />}

      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-[30px] font-bold m-0 leading-tight">{greet}, {first}.</h1>
          <div className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>{dateLine}{r ? ` · day ${r.daysElapsed} of ${r.daysInMonth} in ${monthName(r.month)}` : ""}</div>
        </div>
        {attention > 0 && <a href="#attention" className="rounded-full px-3.5 h-9 inline-flex items-center text-[13px] font-semibold no-underline" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>{attention} {attention === 1 ? "thing" : "things"} to look at ↓</a>}
      </header>

      {tm && r && (
        <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          <Tile label="Spent so far" value={whole(tm.spent)} sub={`of ${whole(tm.budgeted)} budgeted`}>
            <Bar pct={tm.budgeted ? tm.spent / tm.budgeted : 0} tick={elapsedPct} color={tm.spent > tm.budgeted * Math.max(elapsedPct, 0.01) * 1.1 ? "var(--neg)" : "var(--navy)"} />
          </Tile>
          <Tile label="On pace to spend" value={whole(tm.onPace)} sub={paceDiff > 0 ? `${whole(paceDiff)} over budget` : `${whole(-paceDiff)} under budget`} color={paceDiff > 0 ? "var(--neg)" : "var(--green-text)"} onClick={() => { location.hash = "reports"; }} />
          <Tile label="Ready to assign" value={whole(m.view.readyToAssign)} sub={m.view.readyToAssign === 0 ? "All money assigned" : m.view.readyToAssign > 0 ? "waiting for a job" : "over-assigned"} color={m.view.readyToAssign < 0 ? "var(--neg)" : m.view.readyToAssign > 0 ? "var(--green-text)" : undefined} onClick={() => { location.hash = "budget"; }} />
          <Tile label="Days of buffer" value={Number.isFinite(m.daysOfBuffer) ? String(m.daysOfBuffer) : "∞"} sub={facts?.nextMonth ? `next month's money ${whole(facts.nextMonth.available)}${facts.nextMonth.needed ? ` of ${whole(facts.nextMonth.needed)}` : ""}` : "on-budget cash ÷ daily spend"} />
        </section>
      )}

      {(spendPara.length > 0 || savePara.length > 0) && (
        <section className="grid gap-4 md:grid-cols-2">
          <Card title="Spending" sub={r ? `${monthName(r.month)} so far` : undefined} action={<a href="#reports" className="text-[12px] font-semibold no-underline" style={{ color: "var(--accent-text)" }}>Reports ›</a>}>
            {spendPara.map((p, i) => <p key={i} className="text-[15px] leading-relaxed m-0">{p}</p>)}
            {r && tm && r.daily && <CumulativeChart daily={r.daily} budget={tm.budgeted} onPace={tm.onPace} daysElapsed={r.daysElapsed} month={r.month} prevMonth={r.prevMonth} />}
          </Card>
          <Card title="Saving" sub="income, next month and the cushion" action={<a href="#budget" className="text-[12px] font-semibold no-underline" style={{ color: "var(--accent-text)" }}>Budget ›</a>}>
            {savePara.map((p, i) => <p key={i} className="text-[15px] leading-relaxed m-0">{p}</p>)}
            {months.length > 1 && (
              <div className="mt-2 pt-3 flex items-end gap-2" style={{ borderTop: "1px solid var(--border-soft)", height: 92 }}>
                {months.map((x) => { const kept = x.income - x.spent; const h = Math.max(3, Math.round((Math.abs(kept) / keptScale) * 48)); return (
                  <div key={x.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${monthName(x.month)}: ${formatMoney(x.income)} in, ${formatMoney(x.spent)} out`}>
                    <span className="text-[11px] tabular-nums" style={{ color: kept >= 0 ? "var(--green-text)" : "var(--neg)" }}>{kept >= 0 ? "+" : "−"}{whole(Math.abs(kept)).slice(1)}</span>
                    <div className="w-full rounded-sm" style={{ height: h, background: kept >= 0 ? "var(--green-solid)" : "var(--neg)", opacity: x.month === r?.month ? 1 : 0.55 }} />
                    <span className="text-[11px]" style={{ color: "var(--muted)" }}>{MON[Number(x.month.slice(5, 7)) - 1]}</span>
                  </div>
                ); })}
              </div>
            )}
            {months.length > 1 && <div className="text-[11px] -mt-1" style={{ color: "var(--muted)" }}>Kept after spending, by month (this month so far is lighter)</div>}
          </Card>
        </section>
      )}

      <section id="attention" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
        {/* column 1: decisions */}
        <div className="flex flex-col gap-4 min-w-0">
          {pending.length > 0 && (
            <Card title="To confirm" sub={`${pending.length} recurring ${pending.length === 1 ? "bill" : "bills"} landed`} tone="yellow">
              {pending.map((p) => (
                <Row key={p.id} main={p.payee ?? "—"} sub={`${md(p.date)} · ${catName(p.categoryId)} · ${acctName(p.accountId)}`} amount={p.amount}>
                  <button onClick={() => act(p.id, "confirm", p.payee ?? "entry")} className="rounded-full px-2.5 h-7 text-[12px] font-semibold" style={{ background: "var(--green-solid)", color: "#fff" }}>Confirm</button>
                  {openEdit && <button onClick={() => openEdit(p.id)} className="rounded-full px-2.5 h-7 text-[12px] font-semibold" style={{ border: "1px solid var(--field)" }}>Adjust</button>}
                  <button onClick={() => act(p.id, "skip", p.payee ?? "entry")} className="rounded-full px-2 h-7 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Skip</button>
                </Row>
              ))}
            </Card>
          )}
          {dupes.length > 0 && (
            <Card title="⚠️ Possible duplicates" sub="same payee and amount within 3 days" flush>
              {dupes.map((p, i) => <DupPairRow key={p.key} pair={p} last={i === dupes.length - 1} onDone={refresh} />)}
            </Card>
          )}
          {flags.length > 0 && (
            <Card title="🚩 Flagged entries" sub={`${flags.length} open`} flush>
              {flags.map((f, i) => { const last = f.notes[f.notes.length - 1]; const mine = last?.userId === me.id; return (
                <button key={f.id} onClick={() => setFlagOpen(f)} className="w-full text-left px-4 py-2.5 flex flex-col gap-1" style={{ borderBottom: i < flags.length - 1 ? "1px solid var(--border-soft)" : undefined }}>
                  <span className="flex justify-between items-baseline gap-3"><span className="text-sm font-medium truncate">{f.payee || "(no payee)"}</span><span className="text-sm font-semibold tabular-nums shrink-0">{formatMoney(Math.abs(f.amount))}</span></span>
                  <span className="text-xs truncate" style={{ color: "var(--muted)" }}>{md(f.date)}{f.category ? ` · ${f.category}` : ""}</span>
                  {last && <span className="text-[13px] rounded-lg px-2.5 py-1.5 whitespace-pre-wrap" style={{ background: mine ? "var(--selected)" : "var(--yellow-bg)" }}><strong>{mine ? "You" : last.who}:</strong> {last.text}</span>}
                  <span className="text-xs" style={{ color: "var(--accent-text)" }}>{mine ? "Waiting for a reply ›" : "Reply or resolve ›"}</span>
                </button>
              ); })}
            </Card>
          )}
          {(overspent.length > 0 || under.length > 0) && (
            <Card title="Budget check" sub="tap a line to fix it in the budget" flush>
              {overspent.map((c) => <LineRow key={c.categoryId} label={catName(c.categoryId)} note="overspent" amount={c.available} onClick={() => goCategory(c.categoryId)} />)}
              {under.map((c) => <LineRow key={c.categoryId} label={catName(c.categoryId)} note={c.status === "not_enough" ? "not enough for its goal" : "underfunded"} amount={-c.short} onClick={() => goCategory(c.categoryId)} />)}
            </Card>
          )}
          {attention === 0 && <Card title="Nothing needs a decision" sub="no bills to confirm, no flags, no duplicates, and every line is funded"><p className="text-sm m-0" style={{ color: "var(--muted)" }}>Enjoy the quiet.</p></Card>}
          <Card title="Recent entries" action={<button onClick={() => goTransactions(null)} className="text-[12px] font-semibold" style={{ color: "var(--accent-text)" }}>All ›</button>} flush>
            {d.recent.slice(0, 8).map((x, i) => (
              <button key={x.id + (x.half?.share ?? "")} onClick={() => openEdit?.(x.id)} className="w-full text-left px-4 py-2 flex items-center gap-3" style={{ borderBottom: i < Math.min(d.recent.length, 8) - 1 ? "1px solid var(--border-soft)" : undefined }}>
                <span className="w-12 shrink-0 text-[12px] tabular-nums" style={{ color: "var(--muted)" }}>{md(x.date)}</span>
                <span className="flex-1 min-w-0 flex flex-col"><span className="text-sm font-medium truncate">{x.payee ?? (x.transferToAccountId ? "Transfer" : "—")}{x.flagOpen ? " 🚩" : ""}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{x.transferToAccountId ? `${acctName(x.accountId)} → ${acctName(x.transferToAccountId)}` : `${x.lines.length > 1 ? "Split" : catName(x.lines[0]?.categoryId ?? null)} · ${acctName(x.accountId)}`}</span></span>
                <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: (x.amount ?? 0) > 0 ? "var(--green-text)" : undefined }}>{x.amount === null ? "—" : (x.amount < 0 ? "−" : "+") + formatMoney(Math.abs(x.amount))}</span>
              </button>
            ))}
          </Card>
        </div>

        {/* column 2: where the money went */}
        <div className="flex flex-col gap-4 min-w-0">
          {spendCats.length > 0 && (
            <Card title="Spend by category" sub="this month, against each line's budget" action={<a href="#reports" className="text-[12px] font-semibold no-underline" style={{ color: "var(--accent-text)" }}>All ›</a>}>
              {spendCats.map((c) => (
                <button key={c.id} onClick={() => goToTransactions({ category: c.id, month: m.month })} className="text-left flex flex-col gap-1">
                  <span className="flex justify-between gap-3 text-[13px]"><span className="truncate">{c.emoji ? `${c.emoji} ` : ""}{c.name}</span><span className="tabular-nums shrink-0"><strong>{whole(c.spent)}</strong>{c.budget ? <span style={{ color: "var(--muted)" }}> / {whole(c.budget)}</span> : null}</span></span>
                  <Bar pct={c.spent / spendScale} tick={c.budget ? c.budget / spendScale : undefined} color={c.budget && c.spent > c.budget ? "var(--neg)" : "var(--bar, #89bdec)"} thin />
                </button>
              ))}
            </Card>
          )}
          {owners.length > 0 && tm && tm.spent > 0 && (
            <Card title="Whose spending" sub="shared household lines vs each person's own">
              <div className="flex h-3 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
                {owners.map((o) => <div key={o.who} style={{ width: `${o.share * 100}%`, background: o.who === "shared" ? "var(--navy)" : o.who === "D" ? "#4FA3E0" : "#7D87DC" }} title={`${o.who}: ${formatMoney(o.spent)}`} />)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                {owners.map((o) => <span key={o.who} className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: o.who === "shared" ? "var(--navy)" : o.who === "D" ? "#4FA3E0" : "#7D87DC" }} />{o.who === "shared" ? "Shared" : r?.people[o.who]} <strong className="tabular-nums">{whole(o.spent)}</strong><span style={{ color: "var(--muted)" }}>{Math.round(o.share * 100)}%</span></span>)}
              </div>
            </Card>
          )}
          {movers.length > 0 && r && (
            <Card title="Moved most vs last month" sub={`same point in ${monthName(r.prevMonth)}`} flush>
              {movers.map((x) => <LineRow key={x.id} label={`${x.emoji ? `${x.emoji} ` : ""}${x.name}`} note={`${whole(x.before)} → ${whole(x.now)}`} amount={-x.delta} signed onClick={() => goToTransactions({ category: x.id, month: m.month })} />)}
            </Card>
          )}
          {fun.length > 0 && (
            <Card title="Fun money" sub="what's left, and what that is per week">
              <div className="grid grid-cols-2 gap-3">
                {fun.map((f) => (
                  <button key={f.who} onClick={() => goCategory(f.id)} className="rounded-xl p-3 text-left flex flex-col gap-0.5" style={{ background: f.who === (me.initial ?? "D") ? "var(--selected)" : "var(--group)" }}>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>{f.person}{f.who === (me.initial ?? "D") ? " (you)" : ""}</span>
                    <span className="text-[22px] font-bold tabular-nums" style={{ color: f.available < 0 ? "var(--neg)" : undefined }}>{formatMoney(f.available)}</span>
                    <span className="text-[12px]" style={{ color: "var(--muted)" }}>{f.available > 0 ? `${formatMoney(f.perWeek)} a week for ${f.weeksLeft} weeks` : f.available < 0 ? "in the red" : "spent for the month"}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* column 3: what's coming */}
        <div className="flex flex-col gap-4 min-w-0 md:col-span-2 xl:col-span-1">
          <Card title="Upcoming bills" sub={upcoming.length ? `next 3 weeks · ${formatMoney(-upcomingTotal)}` : "next 3 weeks"} flush action={<button onClick={() => { try { sessionStorage.setItem("settings-section", "recurring"); } catch { /* private */ } location.hash = "settings"; }} className="text-[12px] font-semibold" style={{ color: "var(--accent-text)" }}>Repeats ›</button>}>
            {upcoming.length === 0 ? <p className="text-sm m-0 px-4 py-3" style={{ color: "var(--muted)" }}>Nothing due in the next three weeks.</p> : upcoming.map((b, i) => (
              <Row key={b.id + b.date} main={`${b.payee}${b.pending ? " · landed, to confirm" : ""}`} sub={`${dayLabel(b.date, todayIso)} · ${catName(b.categoryId)} · ${acctName(b.accountId)}`} amount={b.amount} last={i === upcoming.length - 1} muted={b.pending} />
            ))}
          </Card>
          {openTracked_.length > 0 && (
            <Card title="Tracked amounts" sub="gifts, refunds and windfalls being spent down" flush>
              {openTracked_.map((x, i) => (
                <button key={x.id} onClick={() => openTracked(x.id)} className="w-full text-left px-4 py-2.5 flex flex-col gap-1.5" style={{ borderBottom: i < openTracked_.length - 1 ? "1px solid var(--border-soft)" : undefined }}>
                  <span className="flex justify-between gap-3 text-sm"><span className="font-medium truncate">{x.emoji ? `${x.emoji} ` : ""}{x.name}</span><span className="tabular-nums shrink-0"><strong>{formatMoney(x.left)}</strong><span style={{ color: "var(--muted)" }}> left of {formatMoney(x.amount)}</span></span></span>
                  <Bar pct={x.amount ? x.spent / x.amount : 0} color="var(--navy)" thin />
                </button>
              ))}
            </Card>
          )}
          <Card title="Accounts" sub="balances today" flush>
            {onBudget.map((a, i) => (
              <button key={a.id} onClick={() => goTransactions(a.id)} className="w-full text-left px-4 py-2 flex justify-between items-center gap-3" style={{ borderBottom: i < onBudget.length - 1 ? "1px solid var(--border-soft)" : undefined }}>
                <span className="text-sm truncate">{a.name}</span><span className="text-sm font-semibold tabular-nums" style={{ color: a.balance < 0 ? "var(--neg)" : undefined }}>{formatMoney(a.balance)}</span>
              </button>
            ))}
            {m.view.owedOnCards > 0 && <div className="px-4 py-2 text-[12px] flex justify-between" style={{ color: "var(--muted)", borderTop: "1px solid var(--border-soft)" }}><span>Owed on cards</span><span className="tabular-nums">{formatMoney(m.view.owedOnCards)}{m.view.uncoveredCardDebt > 0 ? ` · ${formatMoney(m.view.uncoveredCardDebt)} not covered` : " · covered"}</span></div>}
          </Card>
          {m.check && !m.check.ok && Array.isArray(m.check.diffs) && (
            <Card title="Sheet check" sub={m.check.source ?? undefined} tone="yellow">
              <p className="text-[13px] m-0">{m.check.diffs.length} {m.check.diffs.length === 1 ? "figure differs" : "figures differ"} from the spreadsheet. <a href="#budget" style={{ color: "var(--accent-text)" }}>See which ›</a></p>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}

function dayLabel(iso: string, todayIso: string): string {
  const diff = Math.round((Date.parse(iso) - Date.parse(todayIso)) / 86_400_000);
  if (diff <= 0) return diff === 0 ? "Today" : `${-diff}d overdue`;
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return DAYS[new Date(iso + "T12:00:00").getDay()]!;
  return md(iso);
}

function Card({ title, sub, action, tone, flush, children }: { title: string; sub?: string; action?: ReactNode; tone?: "yellow"; flush?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", border: `1px solid ${tone === "yellow" ? "var(--yellow)" : "var(--border)"}` }}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5" style={tone === "yellow" ? { background: "var(--yellow-row)" } : undefined}>
        <div className="min-w-0"><h2 className="text-[15px] font-bold m-0 leading-tight">{title}</h2>{sub && <div className="text-[12px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>{sub}</div>}</div>
        {action}
      </div>
      <div className={flush ? "flex flex-col" : "flex flex-col gap-2.5 px-4 pb-4"} style={flush ? { borderTop: "1px solid var(--border-soft)" } : undefined}>{children}</div>
    </section>
  );
}

function Tile({ label, value, sub, color, onClick, children }: { label: string; value: string; sub?: string; color?: string; onClick?: () => void; children?: ReactNode }) {
  const inner = (
    <>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-[26px] font-bold tabular-nums leading-tight mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>}
      {children && <div className="mt-2">{children}</div>}
    </>
  );
  const cls = "rounded-2xl px-4 py-3.5 text-left flex flex-col";
  const style = { background: "var(--card)", border: "1px solid var(--border)" };
  return onClick ? <button onClick={onClick} className={cls} style={style}>{inner}</button> : <div className={cls} style={style}>{inner}</div>;
}

function Bar({ pct, tick, color, thin }: { pct: number; tick?: number; color: string; thin?: boolean }) {
  const w = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <div className="relative w-full rounded-full overflow-hidden" style={{ height: thin ? 6 : 10, background: "var(--track)" }}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      {tick !== undefined && tick > 0 && tick <= 1 && <div className="absolute top-0 bottom-0" style={{ left: `calc(${tick * 100}% - 1px)`, width: 2, background: "var(--text)" }} />}
    </div>
  );
}

function Row({ main, sub, amount, children, last, muted }: { main: string; sub: string; amount: number; children?: ReactNode; last?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: last ? undefined : "1px solid var(--border-soft)", opacity: muted ? 0.6 : 1 }}>
      <span className="flex-1 min-w-0 flex flex-col"><span className="text-sm font-medium truncate">{main}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{sub}</span></span>
      <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: amount > 0 ? "var(--green-text)" : undefined }}>{formatMoney(Math.abs(amount))}</span>
      {children && <span className="flex gap-1.5 shrink-0">{children}</span>}
    </div>
  );
}

function LineRow({ label, note, amount, signed, onClick }: { label: string; note: string; amount: number; signed?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-2 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <span className="flex-1 min-w-0 flex flex-col"><span className="text-sm font-medium truncate">{label}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{note}</span></span>
      <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: amount < 0 ? "var(--neg)" : "var(--green-text)" }}>{signed ? (amount < 0 ? "+" : "−") + formatMoney(Math.abs(amount)) : formatMoney(amount)}</span>
    </button>
  );
}

/** Running total of spending by day: this month so far, last month for the shape, and the budget as the line to stay under. */
function CumulativeChart({ daily, budget, onPace, daysElapsed, month, prevMonth }: { daily: { thisMonth: number[]; lastMonth: number[] }; budget: number; onPace: number; daysElapsed: number; month: string; prevMonth: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const W = 520, H = 150, L = 44, R = 10, T = 10, B = 22;
  const dim = daily.thisMonth.length, pdim = daily.lastMonth.length;
  const maxY = Math.max(budget, onPace, daily.thisMonth[dim - 1] ?? 0, daily.lastMonth[pdim - 1] ?? 0, 1) * 1.05;
  const x = (day: number, n: number) => L + ((day - 1) / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (xs: number[], n: number, upTo: number) => xs.slice(0, upTo).map((v, i) => `${i ? "L" : "M"}${x(i + 1, n).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => Math.round((maxY * f) / 100) * 100);
  const hover = hot !== null ? { day: hot, now: daily.thisMonth[hot - 1], before: daily.lastMonth[hot - 1] } : null;
  return (
    <div className="mt-2 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
      <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
        <span>Running total by day</span>
        <span className="flex gap-3"><span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "var(--navy)" }} />{monthName(month)}</span><span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "var(--muted)", opacity: 0.7 }} />{monthName(prevMonth)}</span><span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "var(--navy)", opacity: 0.5 }} />on pace</span><span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "var(--neg)" }} />budget</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHot(null)} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHot(Math.max(1, Math.min(dim, Math.round(1 + ((px - L) / (W - L - R)) * (dim - 1))))); }}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" /><text x={L - 6} y={y(v) + 3} fontSize="9" textAnchor="end" fill="var(--muted)">{whole(v)}</text></g>)}
        {budget > 0 && <line x1={L} x2={W - R} y1={y(budget)} y2={y(budget)} stroke="var(--neg)" strokeDasharray="4 3" strokeWidth="1" />}
        <path d={path(daily.lastMonth, pdim, pdim)} fill="none" stroke="var(--muted)" strokeWidth="1.5" opacity="0.6" strokeDasharray="3 3" />
        {daysElapsed > 0 && <path d={path(daily.thisMonth, dim, daysElapsed)} fill="none" stroke="var(--navy)" strokeWidth="2.5" strokeLinejoin="round" />}
        {daysElapsed > 0 && daysElapsed < dim && <line x1={x(daysElapsed, dim)} y1={y(daily.thisMonth[daysElapsed - 1] ?? 0)} x2={x(dim, dim)} y2={y(onPace)} stroke="var(--navy)" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.7" />}
        {daysElapsed > 0 && <circle cx={x(daysElapsed, dim)} cy={y(daily.thisMonth[daysElapsed - 1] ?? 0)} r="3.5" fill="var(--navy)" />}
        {[1, 5, 10, 15, 20, 25, dim].map((d) => <text key={d} x={x(d, dim)} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--muted)">{d}</text>)}
        {hover && <g><line x1={x(hover.day, dim)} x2={x(hover.day, dim)} y1={T} y2={H - B} stroke="var(--text)" opacity="0.25" />
          <rect x={Math.min(W - R - 150, Math.max(L, x(hover.day, dim) - 75))} y={T} width="150" height="34" rx="6" fill="var(--card)" stroke="var(--border)" />
          <text x={Math.min(W - R - 150, Math.max(L, x(hover.day, dim) - 75)) + 8} y={T + 14} fontSize="10" fill="var(--text)" fontWeight="700">Day {hover.day}</text>
          <text x={Math.min(W - R - 150, Math.max(L, x(hover.day, dim) - 75)) + 8} y={T + 27} fontSize="10" fill="var(--muted)">{hover.day <= daysElapsed && hover.now !== undefined ? `${whole(hover.now)} now` : "—"} · {hover.before !== undefined ? `${whole(hover.before)} in ${MON[Number(prevMonth.slice(5, 7)) - 1]}` : "no data"}</text></g>}
      </svg>
    </div>
  );
}
