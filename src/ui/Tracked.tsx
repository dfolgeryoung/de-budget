import { useEffect, useState } from "react";
import { api, todayISO, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import type { TrackedSummary, TrackedEntry } from "../server/tracked";
import { EmojiButton } from "./EmojiPicker";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { emptyDraft, type EntryDraft } from "./EntryForm";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const OWNER = { shared: "Shared", D: "David", E: "Elizabeth" } as const;

export function Tracked({ lists, me, refreshKey, openEntry }: { lists: Lists; me: { initial?: string }; refreshKey: number; openEntry: (d: EntryDraft) => void }) {
  const [rows, setRows] = useState<TrackedSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, TrackedEntry[]>>({});
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<TrackedSummary | "new" | null>(null);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const isPhone = typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;

  useEffect(() => {
    // Home hands over the amount to open
    let handed: string | null = null;
    try { handed = sessionStorage.getItem("tracked-select"); if (handed) sessionStorage.removeItem("tracked-select"); } catch { /* private mode */ }
    api<{ tracked: TrackedSummary[] }>("/tracked").then((r) => { setRows(r.tracked); setSelected((s) => handed ?? s ?? r.tracked.find((x) => !x.closed)?.id ?? r.tracked[0]?.id ?? null); setEntries({}); });
  }, [refreshKey, tick]);
  useEffect(() => { if (selected && !entries[selected]) api<{ entries: TrackedEntry[] }>(`/tracked/${selected}/entries`).then((r) => setEntries((e) => ({ ...e, [selected]: r.entries }))); }, [selected, entries]);

  const changed = () => { setTick((k) => k + 1); dispatchEvent(new Event("lists-changed")); };
  async function setClosed(x: TrackedSummary, closed: boolean) {
    try { await api(`/tracked/${x.id}`, { method: "PUT", json: { closed } }); toast(closed ? `${x.name} closed` : `${x.name} reopened`); changed(); } catch (e) { toast((e as Error).message); }
  }
  async function remove(x: TrackedSummary) {
    if (!confirm(`Delete "${x.name}"? Only possible while nothing is tagged to it.`)) return;
    try { const r = await api<{ result: string }>(`/tracked/${x.id}`, { method: "DELETE" }); if (r.result === "has-entries") toast("Entries are tagged to it — close it instead"); else { toast("Deleted"); if (selected === x.id) setSelected(null); changed(); } } catch (e) { toast((e as Error).message); }
  }
  const addEntry = (x: TrackedSummary) => openEntry({ ...emptyDraft(lists, me, x.accountId ?? undefined), trackedAmountId: x.id });

  if (!rows) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  const open = rows.filter((x) => !x.closed), closed = rows.filter((x) => x.closed);
  const shown = showClosed ? rows : open;
  const current = rows.find((x) => x.id === selected) ?? null;

  const Bar = ({ x }: { x: TrackedSummary }) => {
    const used = x.amount ? Math.min(1, Math.max(0, x.spent / x.amount)) : 0;
    return (
      <div className="rounded-full overflow-hidden" style={{ height: 8, background: "var(--track)" }}>
        <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: x.closed ? "var(--faint)" : x.left < 0 ? "var(--red)" : "var(--classic-shared-2)", transition: "width 400ms ease-out" }} />
      </div>
    );
  };
  const usedText = (x: TrackedSummary) => (x.left <= 0 ? (x.left < 0 ? `Over by ${formatMoney(-x.left)}` : "Fully used") : `${Math.round((x.spent / x.amount) * 100)}% used`);

  const CardRow = ({ x }: { x: TrackedSummary }) => {
    const active = x.id === selected;
    return (
      <button onClick={() => setSelected(active && isPhone ? null : x.id)} aria-pressed={active} className="w-full text-left rounded-xl flex flex-col gap-2.5 tb-btn" style={{ padding: "14px 16px", background: "var(--card)", border: `1px solid ${active && !isPhone ? "var(--navy)" : "var(--border)"}`, opacity: x.closed ? 0.7 : 1 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-[15px] truncate">{x.emoji ? x.emoji + " " : ""}{x.name}</div>
            <div className="text-xs truncate" style={{ color: "var(--muted)" }}>{formatMoney(x.amount)} · {isPhone ? "" : "received "}{short(x.receivedDate)} · {x.closed ? "closed" : x.accountName ?? OWNER[x.owner]}</div>
          </div>
          <div className="font-bold text-[15px] shrink-0 tabular-nums" style={{ color: x.left < 0 ? "var(--red-text)" : x.closed ? "var(--muted)" : "var(--text)" }}>{formatMoney(x.left)} left</div>
        </div>
        <Bar x={x} />
        <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}><span>Spent {formatMoney(x.spent)} {isPhone ? "·" : "across"} {x.entries} {x.entries === 1 ? "entry" : "entries"}</span><span>{isPhone && !active ? "Tap to open ›" : usedText(x)}</span></div>
      </button>
    );
  };

  const EntryList = ({ x }: { x: TrackedSummary }) => {
    const es = entries[x.id];
    if (!es) return <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Loading…</p>;
    return (
      <div className="flex flex-col">
        {!isPhone && <div className="grid gap-3 text-[11px] font-semibold uppercase tracking-wider pb-1.5" style={{ gridTemplateColumns: "56px minmax(0,1fr) 96px 96px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}><span>Date</span><span>Payee · category</span><span className="text-right">Amount</span><span className="text-right">Left after</span></div>}
        {es.map((e) => (
          <div key={e.id} className="grid gap-3 items-center text-[13px] py-2" style={{ gridTemplateColumns: isPhone ? "minmax(0,1fr) 78px 78px" : "56px minmax(0,1fr) 96px 96px", borderBottom: "1px solid var(--border-soft)" }}>
            {!isPhone && <span style={{ color: "var(--muted)" }}>{short(e.date)}</span>}
            <span className="min-w-0"><span className="block truncate font-semibold">{e.payee || "(no payee)"}</span><span className="block truncate text-xs" style={{ color: "var(--muted)" }}>{isPhone ? short(e.date) + " · " : ""}{e.category ?? "No category"}{e.memo ? ` · ${e.memo}` : ""}</span></span>
            <span className="text-right tabular-nums font-semibold" style={{ color: e.amount < 0 ? "var(--red-text)" : "var(--green-text)" }}>{e.amount < 0 ? "−" : "+"}{formatMoney(Math.abs(e.amount))}</span>
            <span className="text-right tabular-nums" style={{ color: e.leftAfter < 0 ? "var(--red-text)" : "var(--muted)" }}>{formatMoney(e.leftAfter)}</span>
          </div>
        ))}
        <div className="grid gap-3 items-center text-[13px] py-2" style={{ gridTemplateColumns: isPhone ? "minmax(0,1fr) 78px 78px" : "56px minmax(0,1fr) 96px 96px" }}>
          {!isPhone && <span style={{ color: "var(--muted)" }}>{short(x.receivedDate)}</span>}
          <span className="min-w-0"><span className="block truncate font-semibold">{x.note || "Received"}</span><span className="block truncate text-xs" style={{ color: "var(--muted)" }}>{isPhone ? short(x.receivedDate) + " · " : ""}Starting amount</span></span>
          <span className="text-right tabular-nums font-semibold" style={{ color: "var(--green-text)" }}>+{formatMoney(x.amount)}</span>
          <span className="text-right tabular-nums" style={{ color: "var(--muted)" }}>{formatMoney(x.amount)}</span>
        </div>
      </div>
    );
  };

  const actions = (x: TrackedSummary) => (
    <div className="flex flex-wrap gap-2">
      {!x.closed && <button onClick={() => addEntry(x)} className="rounded-lg px-3 h-9 text-[13px] font-semibold tb-btn" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ Entry against this</button>}
      <button onClick={() => setEditing(x)} className="rounded-lg px-3 h-9 text-[13px] font-semibold tb-btn" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Edit</button>
      <button onClick={() => setClosed(x, !x.closed)} className="rounded-lg px-3 h-9 text-[13px] font-semibold tb-btn" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>{x.closed ? "Reopen" : "Close"}</button>
      {x.entries === 0 && <button onClick={() => remove(x)} className="rounded-lg px-3 h-9 text-[13px] font-semibold tb-btn" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--red-text)" }}>Delete</button>}
    </div>
  );

  const intro = "A side ledger for one-off money — a bonus, a gift, a refund. Entries you tag to an amount are deducted from it here and nowhere else: the budget month, income and Classic are unchanged.";
  const empty = <div className="rounded-xl p-6 text-center text-sm" style={{ background: "var(--card)", border: "1px dashed var(--field)", color: "var(--muted)" }}>No tracked amounts yet. Add one when a bonus, gift or refund arrives, then pick "Track against" on the entries you spend from it.</div>;
  const editor = editing && <TrackedEditor lists={lists} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setSelected(id); changed(); }} />;

  if (isPhone) {
    return (
      <div className="flex flex-col -mx-4" style={{ gap: 12 }}>
        <div className="px-5 pb-4 flex flex-col gap-2" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
          <div className="flex items-center justify-between"><span className="w-11" /><h1 className="text-lg font-semibold">Tracked amounts</h1><button aria-label="New tracked amount" onClick={() => setEditing("new")} className="w-11 h-11 rounded-full text-2xl inline-flex items-center justify-center" style={{ background: "rgba(255,255,255,0.14)" }}>+</button></div>
          <p className="m-0 text-[13px] opacity-80">One-off money, tracked on the side. Entries tagged here still count in their normal category; the month and Classic don't change.</p>
        </div>
        <div className="px-3 flex flex-col gap-3">
          {shown.length === 0 && empty}
          {shown.map((x) => (
            <div key={x.id} className="flex flex-col gap-2">
              <CardRow x={x} />
              {x.id === selected && <div className="rounded-xl flex flex-col gap-3" style={{ padding: "4px 16px 14px", background: "var(--card)", border: "1px solid var(--border)" }}><EntryList x={x} />{actions(x)}</div>}
            </div>
          ))}
          {closed.length > 0 && <button onClick={() => setShowClosed((s) => !s)} className="text-[13px] font-semibold text-left px-1" style={{ color: "var(--accent-text)" }}>{showClosed ? "Hide closed amounts" : `Show ${closed.length} closed ${closed.length === 1 ? "amount" : "amounts"} ›`}</button>}
        </div>
        {editor}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="max-w-2xl"><h1 className="text-xl font-bold">Tracked amounts</h1><p className="text-sm mt-1 mb-0" style={{ color: "var(--muted)" }}>{intro}</p></div>
        <button onClick={() => setEditing("new")} className="rounded-lg px-4 h-10 text-[14px] font-semibold tb-btn shrink-0" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ New amount</button>
      </div>
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.25fr)" }}>
        <section aria-label="Amounts" className="flex flex-col gap-3">
          {shown.length === 0 && empty}
          {shown.map((x) => <CardRow key={x.id} x={x} />)}
          {closed.length > 0 && <button onClick={() => setShowClosed((s) => !s)} className="text-[13px] font-semibold text-left px-1" style={{ color: "var(--accent-text)" }}>{showClosed ? "Hide closed amounts" : `Show ${closed.length} closed ${closed.length === 1 ? "amount" : "amounts"} ›`}</button>}
        </section>
        {current && (
          <aside aria-label={`${current.name} details`} className="rounded-xl flex flex-col gap-4" style={{ padding: "16px 18px", background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-bold text-[16px] truncate">{current.emoji ? current.emoji + " " : ""}{current.name}</div><div className="text-xs" style={{ color: "var(--muted)" }}>Entries tagged to this amount, newest first{current.note ? ` · ${current.note}` : ""}</div></div>
              {actions(current)}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[["Amount", current.amount], ["Spent", current.spent], ["Left", current.left]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg px-3 py-2.5" style={{ background: "var(--group)" }}><div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{k}</div><div className="font-bold text-[18px] tabular-nums" style={{ color: k === "Left" && (v as number) < 0 ? "var(--red-text)" : undefined }}>{formatMoney(v as number)}</div></div>
              ))}
            </div>
            <EntryList x={current} />
            <p className="m-0 text-xs rounded-lg px-3 py-2.5" style={{ background: "var(--selected)", color: "var(--text-2)" }}>To add an entry here, pick "Track against → {current.name}" on the entry form. The entry still lands in its normal category.</p>
          </aside>
        )}
      </div>
      {editor}
    </div>
  );
}

function TrackedEditor({ lists, initial, onClose, onSaved }: { lists: Lists; initial: TrackedSummary | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(initial?.emoji ?? null);
  const [amountText, setAmountText] = useState(initial ? (initial.amount / 100).toFixed(2) : "");
  const [date, setDate] = useState(initial?.receivedDate ?? todayISO());
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [owner, setOwner] = useState<"D" | "E" | "shared">(initial?.owner ?? "shared");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const field = "w-full rounded-lg px-3 text-[15px] outline-none fld";
  const fieldStyle = { height: 42, border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;
  async function save() {
    const amount = Math.round(Number(amountText.replace(/[$,\s]/g, "")) * 100);
    if (!name.trim()) return toast("Give it a name");
    if (!(amount > 0)) return toast("Enter the amount received");
    setBusy(true);
    try {
      const json = { name: name.trim(), emoji, amount, receivedDate: date, accountId, owner, note: note.trim() || null };
      if (initial) { await api(`/tracked/${initial.id}`, { method: "PUT", json }); onSaved(initial.id); }
      else { const r = await api<{ id: string }>("/tracked", { method: "POST", json }); onSaved(r.id); }
      toast(initial ? "Saved" : `${json.name} added — pick it under "Track against" on entries`);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-4">
        <h2 className="font-bold text-base m-0">{initial ? "Edit tracked amount" : "New tracked amount"}</h2>
        <div className="flex gap-2 items-center">
          <EmojiButton value={emoji} onPick={setEmoji} size={42} placeholder="🎁" />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Elizabeth's Q3 bonus" aria-label="Name" className={field} style={fieldStyle} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>Amount received<input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="2000.00" className={field + " tabular-nums"} style={fieldStyle} /></label>
          <div className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>Received on<div className="flex items-center rounded-lg fld" style={fieldStyle}><span className="flex-1 min-w-0 px-3 text-[15px] font-normal" style={{ color: "var(--text)" }}>{short(date)}, {date.slice(0, 4)}</span><DatePicker value={date} today={todayISO()} onChange={setDate} /></div></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>Landed in<Select ariaLabel="Account" value={accountId ?? ""} onChange={(v) => setAccountId(v || null)} options={[{ value: "", label: "Any account" }, ...lists.accounts.map((a) => ({ value: a.id, label: a.name }))]} className="w-full" style={{ height: 42, borderRadius: 8, fontSize: 15 }} /></div>
          <div className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>Whose<Select ariaLabel="Whose" value={owner} onChange={(v) => setOwner((v || "shared") as "D" | "E" | "shared")} options={[{ value: "shared", label: "Shared" }, { value: "D", label: "David" }, { value: "E", label: "Elizabeth" }]} className="w-full" style={{ height: 42, borderRadius: 8, fontSize: 15 }} /></div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where it came from" className={field} style={fieldStyle} /></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 h-10 text-[14px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 h-10 text-[14px] font-semibold disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>{initial ? "Save" : "Add"}</button>
        </div>
      </div>
    </Sheet>
  );
}
