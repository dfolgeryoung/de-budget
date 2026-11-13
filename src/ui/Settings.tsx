import { useEffect, useState } from "react";
import { api, categoryOptions, todayISO, PHONE_NAV_OPTIONS, DEFAULT_PHONE_NAV, type Lists } from "./api";
import { Select } from "./Select";
import { EmojiButton } from "./EmojiPicker";
import { formatMoney, parseMoney } from "../budget/money";
import { useToast } from "./Toast";

export function Settings() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const r = await fetch("/api/import/sheet", { method: "POST", headers: { "content-type": "text/plain" }, body: text });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(j.error ?? r.statusText));
      setResult(
        `Imported ${j.transactions} entries (${j.lines} lines), ${j.categories} categories in ${j.groups} groups, ${j.accounts} accounts, ` +
          `${j.assignments} assigned amounts, ${j.goals} goals, ${j.recurring} recurring bills. First month ${j.firstMonth}; live months ${(j.months as string[]).join(", ")}.`,
      );
    } catch (e) {
      setResult(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-5xl min-w-0">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Shared settings change the budget for both of you; the ones marked "per person" only change your own app.</p>
      </div>
      <nav aria-label="Settings sections" className="no-bar flex gap-2 overflow-x-auto pb-1 text-[13px] font-semibold">
        {[["accounts", "Accounts"], ["categories", "Categories & groups"], ["recurring", "Recurring bills"], ["csv", "Import CSV"], ["notifications", "Notifications"], ["appearance", "Appearance & profile"], ["import", "Import"], ["mirror", "Sheet mirror"]].map(([id, label]) => <a key={id} href={`#settings/${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="pill" style={{ background: "var(--card)", color: "var(--text-2)", border: "1px solid var(--field)" }}><span className="tb">{label}</span></a>)}
      </nav>
      <AccountsSection />
      <CategoriesSection />
      <RecurringSection />
      <CsvSection />
      <NotificationsSection />
      <AppearanceSection />
      <div id="s-import" />
      <section className="rounded-xl p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="font-bold">Import from the spreadsheet</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Drop the budget's text export (the file with "## Sheet name:" sections). It loads accounts, categories and groups, goals,
          assigned amounts, every ledger entry, recurring bills and the Jul–Oct history, and records the sheet's own figures so the
          Budget screen can check itself against them. Running it again replaces what came from the sheet; entries made in the app are kept.
        </p>
        <label className="inline-flex items-center gap-3 text-sm font-semibold rounded-lg px-4 py-3 cursor-pointer w-fit" style={{ background: "var(--navy)", color: "var(--navy-text)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Importing…" : "Choose export file"}
          <input type="file" accept=".txt,.csv,text/plain" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {result && (
          <p className="text-sm rounded-lg p-3" style={{ background: result.startsWith("Import failed") ? "var(--red-bg)" : "var(--green-bg)", color: result.startsWith("Import failed") ? "var(--red-text)" : "var(--green-text)" }}>
            {result}
          </p>
        )}
      </section>
      <div id="s-mirror" />
      <MirrorSection />
      <p className="text-xs" style={{ color: "var(--muted)" }}>Tags management, tracked amounts, payees, notifications and the home-screen layout arrive in later phases.</p>
    </div>
  );
}

interface MirrorStatus { configured: boolean; sheetId: string | null; backupFolder: boolean; last: { at: string; ledgerRows: number; months: string[]; moves: number; inboxAdded?: number; reconciled?: number; backup?: string; warnings: string[]; by?: string } | null }

/** The bridge to the spreadsheet: which sheet, when it last ran, and buttons to run it now. */
function MirrorSection() {
  const [st, setSt] = useState<MirrorStatus | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api<MirrorStatus>("/mirror/status").then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="rounded-xl p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h2 className="font-bold">Sheet mirror</h2>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Every night the app first takes in anything new in the spreadsheet (rows typed into its Ledger, rows the AppSheet form left in the Inbox), then writes its own entries back into the Ledger, each month's Assigned column and the Money moves log. Entering in the sheet, in AppSheet or here all end up in the same place; if the same entry is edited in both, the app's version wins.
      </p>
      {st && !st.configured && <p className="text-sm rounded-lg p-3" style={{ background: "var(--yellow-row)", color: "var(--yellow-text)" }}>Not connected yet: the Google service account key (GOOGLE_SERVICE_ACCOUNT_B64) isn't set on the server.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={st?.sheetId ? `Spreadsheet: …${st.sheetId.slice(-8)} (paste a link to change)` : "Paste the spreadsheet link"} className="fld rounded-lg px-3 text-sm flex-1 min-w-[16rem] outline-none" style={{ height: 36, border: "1px solid var(--field)", background: "var(--card)" }} />
        <button disabled={!link.trim() || !!busy} onClick={() => run("save", async () => { const r = await api<{ sheetId: string }>("/mirror/sheet", { method: "PUT", json: { sheetId: link.trim() } }); setLink(""); return `Spreadsheet saved (…${r.sheetId.slice(-8)}).`; })} className="rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ height: 36, background: "var(--navy)", color: "var(--navy-text)" }}>Save</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!st?.configured || !st?.sheetId || !!busy} onClick={() => run("mirror", async () => { const r = await api<NonNullable<MirrorStatus["last"]>>("/mirror/run", { method: "POST" }); return `${r.reconciled ? `Took ${r.reconciled} new ${r.reconciled === 1 ? "entry" : "entries"} from the sheet. ` : ""}Wrote ${r.ledgerRows} ledger rows, Assigned for ${r.months.join(", ") || "no months"}, ${r.moves} money moves.${r.warnings.length ? " " + r.warnings.join(" · ") : ""}`; })} className="rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ height: 36, border: "1px solid var(--field)", background: "var(--card)" }}>{busy === "mirror" ? "Writing…" : "Mirror to the sheet now"}</button>
        <button disabled={!st?.configured || !st?.sheetId || !!busy} onClick={() => run("inbox", async () => { const r = await api<{ added: number; skipped: string[] }>("/mirror/inbox", { method: "POST" }); return `Picked up ${r.added} Inbox ${r.added === 1 ? "entry" : "entries"}.${r.skipped.length ? " Skipped: " + r.skipped.join("; ") : ""}`; })} className="rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ height: 36, border: "1px solid var(--field)", background: "var(--card)" }}>{busy === "inbox" ? "Reading…" : "Pick up the Inbox now"}</button>
      </div>
      {st?.last && <p className="text-xs" style={{ color: "var(--muted)" }}>Last mirrored {when(st.last.at)}: {st.last.reconciled ? `${st.last.reconciled} taken from the sheet, ` : ""}{st.last.ledgerRows} ledger rows, {st.last.months.join(", ") || "no month tabs"}, {st.last.moves} money moves{st.last.backup ? ", backup copied to Drive" : ""}.{st.last.warnings.length ? ` Warnings: ${st.last.warnings.join(" · ")}` : ""}</p>}
      {msg && <p className="text-sm rounded-lg p-3" style={{ background: msg.ok ? "var(--green-bg)" : "var(--red-bg)", color: msg.ok ? "var(--green-text)" : "var(--red-text)" }}>{msg.text}</p>}
    </section>
  );
}

interface SettingsAll {
  accounts: { id: string; name: string; type: "checking" | "savings" | "credit_card"; onBudget: boolean; owner: "D" | "E" | "shared"; startingBalance: number; startingDate: string; closed: boolean }[];
  groups: { id: string; name: string; system: boolean }[];
  categories: { id: string; name: string; emoji: string | null; groupId: string; kind: string; hidden: boolean; classicBucket: string | null; classicRule: "none" | "by_account" | "utilities_split" | "phone_split" | "drive_split"; favourite: number | null }[];
  classicLines: { name: string; column: string; section: string }[];
}
const sec = "rounded-xl p-4 md:p-5 flex flex-col gap-3 min-w-0";
const secStyle = { background: "var(--card)", border: "1px solid var(--border)" } as const;
const fieldStyle = { height: 32, border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;
const refreshApp = () => dispatchEvent(new Event("lists-changed"));
const usePhone = () => typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;

/** A text field that saves on blur or Enter and shows nothing while unchanged. */
function TextCell({ value, onSave, className = "", placeholder, width }: { value: string; onSave: (v: string) => Promise<void> | void; className?: string; placeholder?: string; width?: number | string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v.trim() !== value && v.trim()) onSave(v.trim()); else setV(value); };
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(value); }} placeholder={placeholder} className={"fld rounded-md px-2 text-[13px] outline-none min-w-0 " + className} style={{ ...fieldStyle, width }} />;
}

function useSettingsAll() {
  const [all, setAll] = useState<SettingsAll | null>(null);
  const load = () => api<SettingsAll>("/settings/all").then(setAll).catch(() => setAll(null));
  useEffect(() => { load(); }, []);
  return { all, load };
}

function AccountsSection() {
  const { all, load } = useSettingsAll();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: "", type: "checking" as "checking" | "savings" | "credit_card", owner: "shared" as "D" | "E" | "shared", onBudget: true, startingBalance: "", startingDate: new Date().toISOString().slice(0, 10) });
  const put = async (id: string, body: object) => { try { await api(`/accounts/${id}`, { method: "PUT", json: body }); load(); refreshApp(); } catch (e) { toast(`Not saved: ${(e as Error).message}`); } };
  const grid = "minmax(140px,1.4fr) 130px 118px 90px 110px 70px";
  const phone = usePhone();
  return (
    <section id="s-accounts" className={sec} style={secStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h2 className="font-bold">Accounts</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Type decides where an account shows; owner drives the Classic columns and the 50/50 rule; off-budget accounts don't feed Ready to Assign.</p></div>
        <button onClick={() => setAdding((v) => !v)} className="rounded-lg px-3 h-8 text-[13px] font-semibold shrink-0" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ Account</button>
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
          <input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="Account name" className="fld rounded-md px-2 text-[13px] outline-none w-full md:w-44" style={fieldStyle} />
          <Select ariaLabel="Type" value={n.type} onChange={(v) => setN({ ...n, type: (v as typeof n.type) ?? "checking" })} options={[{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }, { value: "credit_card", label: "Credit card" }]} style={{ height: 32 }} />
          <Select ariaLabel="Owner" value={n.owner} onChange={(v) => setN({ ...n, owner: (v as typeof n.owner) ?? "shared" })} options={[{ value: "D", label: "David" }, { value: "E", label: "Elizabeth" }, { value: "shared", label: "Shared" }]} style={{ height: 32 }} />
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={n.onBudget} onChange={(e) => setN({ ...n, onBudget: e.target.checked })} /> On budget</label>
          <span className="flex items-center rounded-md px-2 w-32" style={fieldStyle}><span style={{ color: "var(--muted)" }}>$</span><input value={n.startingBalance} onChange={(e) => setN({ ...n, startingBalance: e.target.value })} placeholder="starting" inputMode="decimal" className="w-full min-w-0 bg-transparent outline-none text-right text-[13px]" /></span>
          <input type="date" value={n.startingDate} onChange={(e) => setN({ ...n, startingDate: e.target.value })} className="fld rounded-md px-2 text-[13px] outline-none" style={fieldStyle} />
          <button onClick={async () => { try { await api("/accounts", { method: "POST", json: { ...n, startingBalance: parseMoney(n.startingBalance) ?? 0 } }); setAdding(false); setN({ ...n, name: "", startingBalance: "" }); load(); refreshApp(); toast(`Added ${n.name}`); } catch (e) { toast((e as Error).message); } }} disabled={!n.name.trim()} className="rounded-md px-3 h-8 text-[13px] font-semibold disabled:opacity-50" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Add</button>
        </div>
      )}
      {!all ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : phone ? (
        <div className="flex flex-col gap-2">
          {all.accounts.map((a) => (
            <div key={a.id} className="rounded-lg p-3 flex flex-col gap-2" style={{ border: "1px solid var(--border)", opacity: a.closed ? 0.55 : 1 }}>
              <div className="flex items-center gap-2"><TextCell value={a.name} onSave={(name) => put(a.id, { name })} className="flex-1" /><span className="text-[13px] shrink-0" title={`starting ${a.startingDate}`}>{formatMoney(a.startingBalance)}</span></div>
              <div className="flex gap-2">
                <Select ariaLabel="Type" value={a.type} onChange={(v) => v && put(a.id, { type: v })} options={[{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }, { value: "credit_card", label: "Credit card" }]} style={{ height: 32 }} className="flex-1" />
                <Select ariaLabel="Owner" value={a.owner} onChange={(v) => v && put(a.id, { owner: v })} options={[{ value: "D", label: "David" }, { value: "E", label: "Elizabeth" }, { value: "shared", label: "Shared" }]} style={{ height: 32 }} className="flex-1" />
              </div>
              <div className="flex gap-4 text-[13px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={a.onBudget} onChange={(e) => put(a.id, { onBudget: e.target.checked })} /> On budget</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={a.closed} onChange={(e) => put(a.id, { closed: e.target.checked })} /> Closed</label>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
          <div className="grid gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: grid, color: "var(--muted)", background: "var(--group)", minWidth: 700 }}><span>Account</span><span>Type</span><span>Owner</span><span>On budget</span><span className="text-right">Starting</span><span>Closed</span></div>
          {all.accounts.map((a) => (
            <div key={a.id} className="row-hover grid gap-2 items-center px-3 py-1.5" style={{ gridTemplateColumns: grid, borderTop: "1px solid var(--border-soft)", opacity: a.closed ? 0.55 : 1, minWidth: 700 }}>
              <TextCell value={a.name} onSave={(name) => put(a.id, { name })} />
              <Select ariaLabel="Type" value={a.type} onChange={(v) => v && put(a.id, { type: v })} options={[{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }, { value: "credit_card", label: "Credit card" }]} style={{ height: 32 }} className="w-full" />
              <Select ariaLabel="Owner" value={a.owner} onChange={(v) => v && put(a.id, { owner: v })} options={[{ value: "D", label: "David" }, { value: "E", label: "Elizabeth" }, { value: "shared", label: "Shared" }]} style={{ height: 32 }} className="w-full" />
              <input type="checkbox" checked={a.onBudget} onChange={(e) => put(a.id, { onBudget: e.target.checked })} className="m-0 justify-self-start" />
              <span className="text-right text-[13px]" title={`as of ${a.startingDate}`}>{formatMoney(a.startingBalance)}</span>
              <input type="checkbox" checked={a.closed} onChange={(e) => put(a.id, { closed: e.target.checked })} className="m-0 justify-self-start" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoriesSection() {
  const { all, load } = useSettingsAll();
  const toast = useToast();
  const [showHidden, setShowHidden] = useState(true);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const put = async (id: string, body: object) => { try { await api(`/categories/${id}`, { method: "PUT", json: body }); load(); refreshApp(); } catch (e) { toast(`Not saved: ${(e as Error).message}`); } };
  const RULES: Record<string, string> = { by_account: "By account", utilities_split: "Utilities split", phone_split: "Phone split", drive_split: "Drive split" };
  const colName = (c: string) => (c === "D" ? "David" : c === "E" ? "Elizabeth" : "Shared");
  const grid = "44px minmax(150px,1.5fr) 150px 190px 100px 44px 56px";
  const phone = usePhone();
  if (!all) return <section id="s-categories" className={sec} style={secStyle}><h2 className="font-bold">Categories & groups</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p></section>;
  const lineOptions = [
    ...all.classicLines.filter((l, i, arr) => arr.findIndex((x) => x.name === l.name) === i).map((l) => ({ value: `line:${l.name}`, label: l.name, group: "Classic line", hint: l.name === "Fun Money" ? "by owner" : colName(l.column) })),
    ...Object.entries(RULES).map(([k, v]) => ({ value: `rule:${k}`, label: v, group: "Rule" })),
    { value: "none", label: "— not on Classic —", group: "Other" },
  ];
  const classicValue = (c: SettingsAll["categories"][number]) => (c.classicRule !== "none" ? `rule:${c.classicRule}` : c.classicBucket ? `line:${c.classicBucket === "David Fun Money" || c.classicBucket === "Elizabeth Fun Money" ? "Fun Money" : c.classicBucket}` : "none");
  const classicColumn = (c: SettingsAll["categories"][number]) => {
    if (c.classicRule === "by_account") return "by payer";
    if (c.classicRule !== "none") return "split";
    if (!c.classicBucket) return "—";
    if (c.classicBucket.endsWith(" Fun Money")) return c.classicBucket.startsWith("David") ? "David" : "Elizabeth";
    const l = all.classicLines.find((x) => x.name === c.classicBucket); return l ? colName(l.column) : "?";
  };
  const setClassic = (c: SettingsAll["categories"][number], v: string | null) => {
    if (!v || v === "none") return put(c.id, { classicBucket: null, classicRule: "none" });
    if (v.startsWith("rule:")) return put(c.id, { classicBucket: null, classicRule: v.slice(5) });
    const name = v.slice(5);
    // Fun Money has a line per person: pick by the category's name, else David's
    return put(c.id, { classicRule: "none", classicBucket: name === "Fun Money" ? (/elizabeth/i.test(c.name) ? "Elizabeth Fun Money" : "David Fun Money") : name });
  };
  return (
    <section id="s-categories" className={sec} style={secStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h2 className="font-bold">Categories & groups</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Emoji, name, group, where the category lands on Classic, pinned to the top of pickers (per person), and hidden. Reorder by dragging on the Budget screen; add categories there too.</p></div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden</label>
          <button onClick={() => setNewGroup(newGroup === null ? "" : null)} className="rounded-lg px-3 h-8 text-[13px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>+ Group</button>
        </div>
      </div>
      {newGroup !== null && (
        <div className="flex items-center gap-2">
          <input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name" className="fld rounded-md px-2 text-[13px] outline-none w-56" style={fieldStyle} onKeyDown={async (e) => { if (e.key === "Enter" && newGroup.trim()) { await api("/groups", { method: "POST", json: { name: newGroup.trim() } }); setNewGroup(null); load(); refreshApp(); } if (e.key === "Escape") setNewGroup(null); }} />
          <button onClick={async () => { if (!newGroup.trim()) return; await api("/groups", { method: "POST", json: { name: newGroup.trim() } }); setNewGroup(null); load(); refreshApp(); }} className="rounded-md px-3 h-8 text-[13px] font-semibold" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Add group</button>
        </div>
      )}
      {phone ? (
        <div className="flex flex-col gap-3">
          {all.groups.map((g) => {
            const rows = all.categories.filter((c) => c.groupId === g.id && (showHidden || !c.hidden));
            if (!rows.length && g.system) return null;
            return (
              <div key={g.id} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <div className="px-3 py-2 text-[13px] font-semibold" style={{ background: "var(--group)", color: "var(--text-2)" }}>{g.name}{g.system && <span className="text-[11px] font-normal" style={{ color: "var(--muted)" }}> · system</span>}</div>
                {rows.map((c) => (
                  <div key={c.id} className="flex flex-col gap-2 px-3 py-2.5" style={{ borderTop: "1px solid var(--border-soft)", opacity: c.hidden ? 0.55 : 1 }}>
                    <div className="flex items-center gap-2">
                      <EmojiButton value={c.emoji} onPick={(emoji) => put(c.id, { emoji })} size={36} />
                      <TextCell value={c.name} onSave={(name) => put(c.id, { name })} className="flex-1" />
                      <button aria-label={c.favourite !== null ? "Unpin" : "Pin"} aria-pressed={c.favourite !== null} onClick={() => put(c.id, { favourite: c.favourite === null })} className="text-xl leading-none px-1" style={{ color: c.favourite !== null ? "var(--yellow)" : "var(--faint)" }}>{c.favourite !== null ? "★" : "☆"}</button>
                    </div>
                    {c.kind === "normal" && (
                      <div className="flex gap-2">
                        <Select ariaLabel="Group" value={c.groupId} onChange={(v) => v && put(c.id, { groupId: v })} options={all.groups.filter((x) => !x.system).map((x) => ({ value: x.id, label: x.name }))} style={{ height: 32 }} className="flex-1 min-w-0" />
                        <Select ariaLabel="Classic" value={classicValue(c)} onChange={(v) => setClassic(c, v)} options={lineOptions} style={{ height: 32 }} className="flex-1 min-w-0" menuWidth={240} />
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--muted)" }}>
                      <span>Classic: {classicColumn(c)}</span>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.hidden} onChange={(e) => put(c.id, { hiddenInBudget: e.target.checked })} /> Hidden</label>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
      <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <div className="grid gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: grid, color: "var(--muted)", background: "var(--group)", minWidth: 760 }}><span /><span>Category</span><span>Group</span><span>Classic line / rule</span><span>Column</span><span title="Pinned to the top of pickers (per person)">Pin</span><span>Hidden</span></div>
        {all.groups.map((g) => {
          const rows = all.categories.filter((c) => c.groupId === g.id && (showHidden || !c.hidden));
          if (!rows.length && g.system) return null;
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-semibold" style={{ background: "var(--card-alt)", borderTop: "1px solid var(--border)", minWidth: 760 }}>
                {g.system ? <span style={{ color: "var(--text-2)" }}>{g.name} <span className="text-[11px] font-normal" style={{ color: "var(--muted)" }}>· system</span></span> : <TextCell value={g.name} onSave={async (name) => { await api(`/groups/${g.id}`, { method: "PUT", json: { name } }); load(); refreshApp(); }} width={260} />}
              </div>
              {rows.map((c) => (
                <div key={c.id} className="row-hover grid gap-2 items-center px-3 py-1" style={{ gridTemplateColumns: grid, borderTop: "1px solid var(--border-soft)", opacity: c.hidden ? 0.55 : 1, minWidth: 760 }}>
                  <EmojiButton value={c.emoji} onPick={(emoji) => put(c.id, { emoji })} />
                  <TextCell value={c.name} onSave={(name) => put(c.id, { name })} />
                  {c.kind === "normal" ? <Select ariaLabel="Group" value={c.groupId} onChange={(v) => v && put(c.id, { groupId: v })} options={all.groups.filter((x) => !x.system).map((x) => ({ value: x.id, label: x.name }))} style={{ height: 32 }} className="w-full" /> : <span className="text-[13px]" style={{ color: "var(--muted)" }}>{g.name}</span>}
                  {c.kind === "card_payment" ? <span className="text-[13px]" style={{ color: "var(--muted)" }}>—</span> : <Select ariaLabel="Classic" value={classicValue(c)} onChange={(v) => setClassic(c, v)} options={lineOptions} style={{ height: 32 }} className="w-full" menuWidth={260} />}
                  <span className="text-[13px]" style={{ color: "var(--text-2)" }}>{classicColumn(c)}</span>
                  <button aria-label={c.favourite !== null ? "Unpin" : "Pin"} aria-pressed={c.favourite !== null} onClick={() => put(c.id, { favourite: c.favourite === null })} className="text-lg leading-none justify-self-start" style={{ color: c.favourite !== null ? "var(--yellow)" : "var(--faint)" }}>{c.favourite !== null ? "★" : "☆"}</button>
                  <input type="checkbox" checked={c.hidden} onChange={(e) => put(c.id, { hiddenInBudget: e.target.checked })} className="m-0 justify-self-start" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      )}
      <p className="text-xs" style={{ color: "var(--muted)" }}>Hidden categories stay out of the budget and auto-assign but keep their history. Classic rules: By account (payer's Fun Money, shared account → Misc shared), Utilities split (Power / Utilities by payer), Phone split (Internet keyword → Internet, else Cell Phone), Drive split (by payer).</p>
    </section>
  );
}

function AppearanceSection() {
  const toast = useToast();
  const [me, setMe] = useState<{ avatarEmoji?: string; appearance?: string; showBars?: boolean; phoneNav?: string[] | null; textSize?: string } | null>(null);
  useEffect(() => { api<{ avatarEmoji?: string; appearance?: string; showBars?: boolean; phoneNav?: string[] | null; textSize?: string }>("/me").then(setMe).catch(() => setMe(null)); }, []);
  const nav = me?.phoneNav?.length === 4 ? me.phoneNav : DEFAULT_PHONE_NAV;
  const setSlot = (i: number, id: string) => {
    const next = [...nav];
    const dup = next.indexOf(id);
    if (dup >= 0 && dup !== i) next[dup] = next[i]!; // swap with the slot that already had it
    next[i] = id;
    save({ phoneNav: next });
  };
  const save = async (body: object) => { try { await api("/me", { method: "PUT", json: body }); setMe((m) => ({ ...m, ...body })); dispatchEvent(new Event("me-changed")); } catch (e) { toast(`Not saved: ${(e as Error).message}`); } };
  return (
    <section id="s-appearance" className={sec} style={secStyle}>
      <h2 className="font-bold">Appearance & profile <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>· per person</span></h2>
      {!me ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
          <span className="flex items-center gap-2">Avatar <span className="text-xs" style={{ color: "var(--muted)" }}>— click your picture at the top of the rail (or on More on the phone) to change it</span></span>
          <label className="flex items-center gap-2">Theme <Select ariaLabel="Theme" value={me.appearance ?? "system"} onChange={(v) => save({ appearance: v ?? "system" })} options={[{ value: "system", label: "Match the device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} style={{ height: 32 }} /></label>
          <label className="flex items-center gap-2">Text size <Select ariaLabel="Text size" value={me.textSize ?? "normal"} onChange={(v) => save({ textSize: v ?? "normal" })} options={[{ value: "small", label: "Small" }, { value: "normal", label: "Normal" }, { value: "large", label: "Large" }, { value: "larger", label: "Larger" }]} style={{ height: 32 }} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={me.showBars ?? true} onChange={(e) => save({ showBars: e.target.checked })} /> Show progress bars by default</label>
        </div>
      )}
      {me && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
          <div className="text-[13px] font-semibold">Phone menu <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>— the four screens on the bar at the bottom of the phone; everything else lives under More</span></div>
          <div className="flex flex-wrap gap-2">
            {nav.map((id, i) => <Select key={i} ariaLabel={`Slot ${i + 1}`} value={id} onChange={(v) => v && setSlot(i, v)} options={PHONE_NAV_OPTIONS.map(([v, l]) => ({ value: v, label: l }))} style={{ height: 36, minWidth: 150 }} />)}
            <span className="pill" style={{ background: "var(--group)", color: "var(--muted)" }}><span className="tb">More</span></span>
            {me.phoneNav && <button onClick={() => save({ phoneNav: null })} className="text-xs underline" style={{ color: "var(--muted)" }}>Reset</button>}
          </div>
        </div>
      )}
    </section>
  );
}

interface Rec { id: string; payee: string; accountId: string; categoryId: string | null; memo: string | null; amount: number; dayOfMonth: number | null; everyDays: number | null; anchorDate: string | null; active: boolean; lastCreatedMonth: string | null; nextDue: string | null }

/** Recurring bills: each becomes a pending entry on its day of the month; confirm it (or adjust / skip) on Home or in the ledger. */
function RecurringSection() {
  const toast = useToast();
  const phone = usePhone();
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [adding, setAdding] = useState(false);
  const blank = { payee: "", accountId: "", categoryId: null as string | null, memo: "", amount: "", dayOfMonth: "1", active: true };
  const [n, setN] = useState(blank);
  const load = () => { api<Rec[]>("/recurring").then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])); api<Lists>("/lists").then(setLists).catch(() => {}); };
  useEffect(load, []);
  const put = async (id: string, body: object) => { try { await api(`/recurring/${id}`, { method: "PUT", json: body }); load(); refreshApp(); } catch (e) { toast(`Not saved: ${(e as Error).message}`); } };
  const cats = lists ? categoryOptions(lists, { income: true }) : [];
  const acctOpts = lists ? lists.accounts.map((a) => ({ value: a.id, label: a.name })) : [];
  const AmountCell = ({ r }: { r: Rec }) => <TextCell value={(Math.abs(r.amount) / 100).toFixed(2)} onSave={(v) => { const c = parseMoney(v); if (c !== null) put(r.id, { amount: r.amount > 0 ? Math.abs(c) : -Math.abs(c) }); }} className="text-right" width={80} />;
  const DayCell = ({ r }: { r: Rec }) => <TextCell value={r.dayOfMonth ? String(r.dayOfMonth) : ""} onSave={(v) => put(r.id, { dayOfMonth: /^\d+$/.test(v) ? Math.min(31, Math.max(1, Number(v))) : null })} className="text-center" placeholder="any" width={56} />;
  const REPEATS = [{ value: "month", label: "Monthly" }, { value: "7", label: "Weekly" }, { value: "14", label: "2 weeks" }, { value: "28", label: "4 weeks" }, { value: "30", label: "30 days" }];
  const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (iso: string) => `${MONS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
  // monthly: "day N"; interval: "every N days from <a date it was charged>"; both show when it lands next
  const ScheduleCell = ({ r }: { r: Rec }) => (
    <span className="flex items-center gap-1.5 flex-wrap text-[13px]">
      <Select ariaLabel="Repeats" value={r.everyDays ? String(r.everyDays) : "month"} onChange={(v) => { if (!v || v === "month") put(r.id, { everyDays: null, anchorDate: null }); else put(r.id, { everyDays: Number(v), anchorDate: r.anchorDate ?? todayISO() }); }} options={REPEATS} style={{ height: 32 }} />
      {r.everyDays ? <span className="flex items-center gap-1" style={{ color: "var(--muted)" }}>from <TextCell value={r.anchorDate ?? ""} onSave={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) put(r.id, { anchorDate: v }); else toast("Date as YYYY-MM-DD"); }} placeholder="YYYY-MM-DD" width={94} /></span>
        : <span className="flex items-center gap-1" style={{ color: "var(--muted)" }}>day <DayCell r={r} /></span>}
      {r.nextDue && r.active && <span className="text-[11px]" style={{ color: "var(--faint)" }}>next {shortDate(r.nextDue)}</span>}
    </span>
  );
  const grid = "minmax(120px,1.2fr) 118px minmax(130px,1.1fr) 84px minmax(290px,1.3fr) 36px 48px";
  return (
    <section id="s-recurring" className={sec} style={secStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h2 className="font-bold">Recurring bills</h2><p className="text-sm" style={{ color: "var(--muted)" }}>On its day each bill lands as a pending entry (outside the totals) for you to confirm, adjust or skip on Home. A bill you've already entered by hand that month is left alone. “Every 4 weeks” and the like need one date it was charged; later charges are counted from there, so a bill can land twice in a month. Amounts are outflows; use a minus for an inflow such as a paycheck.</p></div>
        <button onClick={() => setAdding((v) => !v)} className="rounded-lg px-3 h-8 text-[13px] font-semibold shrink-0" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ Recurring bill</button>
      </div>
      {adding && lists && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
          <input value={n.payee} onChange={(e) => setN({ ...n, payee: e.target.value })} placeholder="Payee" className="fld rounded-md px-2 text-[13px] outline-none w-full md:w-44" style={fieldStyle} />
          <Select ariaLabel="Account" value={n.accountId || null} onChange={(v) => setN({ ...n, accountId: v ?? "" })} options={acctOpts} placeholder="Account…" style={{ height: 32 }} />
          <Select ariaLabel="Category" value={n.categoryId} onChange={(v) => setN({ ...n, categoryId: v })} options={cats} placeholder="Category…" style={{ height: 32 }} menuWidth={280} />
          <span className="flex items-center rounded-md px-2 w-28" style={fieldStyle}><span style={{ color: "var(--muted)" }}>$</span><input value={n.amount} onChange={(e) => setN({ ...n, amount: e.target.value })} placeholder="amount" inputMode="decimal" className="w-full min-w-0 bg-transparent outline-none text-right text-[13px]" /></span>
          <span className="flex items-center gap-1 text-[13px]" style={{ color: "var(--muted)" }}>day <input value={n.dayOfMonth} onChange={(e) => setN({ ...n, dayOfMonth: e.target.value })} inputMode="numeric" className="fld w-12 rounded-md px-1 text-center outline-none" style={fieldStyle} /></span>
          <input value={n.memo} onChange={(e) => setN({ ...n, memo: e.target.value })} placeholder="Memo" className="fld rounded-md px-2 text-[13px] outline-none w-36" style={fieldStyle} />
          <button onClick={async () => { const c = parseMoney(n.amount); if (!n.payee.trim() || !n.accountId || c === null) return toast("Payee, account and amount are needed"); try { await api("/recurring", { method: "POST", json: { payee: n.payee.trim(), accountId: n.accountId, categoryId: n.categoryId === "rta" ? null : n.categoryId, memo: n.memo || null, amount: -c, dayOfMonth: /^\d+$/.test(n.dayOfMonth) ? Number(n.dayOfMonth) : null, active: true } }); setAdding(false); setN(blank); load(); refreshApp(); } catch (e) { toast((e as Error).message); } }} className="rounded-md px-3 h-8 text-[13px] font-semibold" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Add</button>
        </div>
      )}
      {!rows || !lists ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : phone ? (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg p-3 flex flex-col gap-2" style={{ border: "1px solid var(--border)", opacity: r.active ? 1 : 0.55 }}>
              <div className="flex items-center gap-2"><TextCell value={r.payee} onSave={(payee) => put(r.id, { payee })} className="flex-1" /><AmountCell r={r} /></div>
              <div className="flex gap-2"><Select ariaLabel="Account" value={r.accountId} onChange={(v) => v && put(r.id, { accountId: v })} options={acctOpts} style={{ height: 32 }} className="flex-1 min-w-0" /><Select ariaLabel="Category" value={r.categoryId ?? "rta"} onChange={(v) => put(r.id, { categoryId: v === "rta" ? null : v })} options={cats} style={{ height: 32 }} className="flex-1 min-w-0" menuWidth={260} /></div>
              <div className="flex items-center justify-between text-[13px]"><ScheduleCell r={r} /><label className="flex items-center gap-1.5"><input type="checkbox" checked={r.active} onChange={(e) => put(r.id, { active: e.target.checked })} /> Active</label><button onClick={async () => { await api(`/recurring/${r.id}`, { method: "DELETE" }); load(); refreshApp(); }} className="text-xs" style={{ color: "var(--red-text)" }}>Delete</button></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
          <div className="grid gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: grid, color: "var(--muted)", background: "var(--group)", minWidth: 860 }}><span>Payee</span><span>Account</span><span>Category</span><span className="text-right">Amount</span><span>Repeats</span><span>Active</span><span /></div>
          {rows.map((r) => (
            <div key={r.id} className="row-hover grid gap-2 items-center px-3 py-1.5" style={{ gridTemplateColumns: grid, borderTop: "1px solid var(--border-soft)", opacity: r.active ? 1 : 0.55, minWidth: 860 }}>
              <TextCell value={r.payee} onSave={(payee) => put(r.id, { payee })} />
              <Select ariaLabel="Account" value={r.accountId} onChange={(v) => v && put(r.id, { accountId: v })} options={acctOpts} style={{ height: 32 }} className="w-full" />
              <Select ariaLabel="Category" value={r.categoryId ?? "rta"} onChange={(v) => put(r.id, { categoryId: v === "rta" ? null : v })} options={cats} style={{ height: 32 }} className="w-full" menuWidth={280} />
              <span className="flex justify-end"><AmountCell r={r} /></span>
              <ScheduleCell r={r} />
              <input type="checkbox" checked={r.active} onChange={(e) => put(r.id, { active: e.target.checked })} className="m-0 justify-self-start" />
              <button onClick={async () => { await api(`/recurring/${r.id}`, { method: "DELETE" }); load(); refreshApp(); toast(`Removed ${r.payee}`); }} className="text-xs justify-self-end" style={{ color: "var(--red-text)" }}>Delete</button>
            </div>
          ))}
          {rows.length === 0 && <p className="px-3 py-3 text-sm" style={{ color: "var(--muted)" }}>No recurring bills yet.</p>}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--muted)" }}>The nightly run creates the day's pending entries; "Bills still to come" on the Budget screen lists the ones not yet seen this month.</p>
    </section>
  );
}

interface Preview {
  account: { id: string; name: string };
  bank: { account: string | null; balance: number | null; asOf: string | null; rows: number; from: string | null; to: string | null };
  appBalance: number;
  matched: { id: string; date: string; payee: string | null; amount: number; bankDate: string; bankPayee: string }[];
  newRows: { key: number; date: string; postedDate: string; payee: string; description: string; amount: number; transfer: boolean; suggestedCategoryId: string | null; suggestedPayee: string | null; bankCategory: string | null }[];
  missing: { id: string; date: string; payee: string | null; amount: number; pending: boolean }[];
}
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${MONS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** Import a bank CSV for one account: matches are marked, missing entries can be added with a category, app entries the bank lacks get a mismatch mark. */
function CsvSection() {
  const toast = useToast();
  const [lists, setLists] = useState<Lists | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState<Record<number, { on: boolean; payee: string; categoryId: string | null; transferToAccountId: string | null }>>({});
  const [flag, setFlag] = useState<Record<string, boolean>>({});
  useEffect(() => { api<Lists>("/lists").then((l) => { setLists(l); setAccountId((a) => a ?? l.accounts[0]?.id ?? null); }).catch(() => {}); }, []);
  async function onFile(f: File) {
    if (!accountId) return toast("Pick the account first");
    setBusy(true); setPreview(null);
    try {
      const p = await api<Preview>("/reconcile/preview", { method: "POST", json: { accountId, csv: await f.text() } });
      setPreview(p);
      const a: typeof add = {}; for (const r of p.newRows) a[r.key] = { on: !r.transfer, payee: r.suggestedPayee ?? r.payee, categoryId: r.suggestedCategoryId, transferToAccountId: null };
      setAdd(a);
      const fl: typeof flag = {}; for (const m of p.missing) fl[m.id] = !m.pending; setFlag(fl);
    } catch (e) { toast(`Couldn't read that file: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api<{ matched: number; mismatches: number; added: number }>("/reconcile/apply", { method: "POST", json: {
        accountId: preview.account.id, matched: preview.matched.map((m) => m.id),
        mismatches: preview.missing.filter((m) => flag[m.id]).map((m) => ({ id: m.id, note: `Not in the bank export of ${preview.bank.asOf ?? "this period"}` })),
        add: preview.newRows.filter((n) => add[n.key]?.on).map((n) => ({ date: n.date, payee: add[n.key]!.payee, memo: "", amount: n.amount, categoryId: add[n.key]!.categoryId === "rta" ? null : add[n.key]!.categoryId, transferToAccountId: add[n.key]!.transferToAccountId })),
      } });
      toast(`Reconciled: ${r.matched} matched, ${r.added} added, ${r.mismatches} marked`); setPreview(null); refreshApp();
    } catch (e) { toast(`Not applied: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  const cats = lists ? categoryOptions(lists, { income: true }) : [];
  const acctOpts = lists ? lists.accounts.map((a) => ({ value: a.id, label: a.name })) : [];
  const money = (c: number) => <span style={{ color: c < 0 ? "var(--neg)" : "var(--green-text)" }}>{formatMoney(c)}</span>;
  return (
    <section id="s-csv" className={sec} style={secStyle}>
      <div><h2 className="font-bold">Import a bank CSV</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Export transactions from the bank (SECU's CSV works as is) and pick the matching account. Entries that line up by amount and date are marked as matched, anything the bank has that the app doesn't can be added with a category, and app entries the bank doesn't show get a ⚠ mark in the ledger.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <Select ariaLabel="Account" value={accountId} onChange={setAccountId} options={acctOpts} placeholder="Account…" style={{ height: 36 }} />
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold rounded-lg px-4 cursor-pointer" style={{ height: 36, background: "var(--navy)", color: "var(--navy-text)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Reading…" : "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy || !accountId} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      </div>
      {preview && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
            <span><strong>{preview.bank.rows}</strong> bank rows{preview.bank.from && preview.bank.to ? ` · ${shortDate(preview.bank.from)} – ${shortDate(preview.bank.to)}` : ""}</span>
            <span><strong>{preview.matched.length}</strong> matched</span>
            <span><strong>{preview.newRows.length}</strong> not in the app</span>
            <span><strong>{preview.missing.length}</strong> not at the bank</span>
            {preview.bank.balance !== null && <span>Bank balance {formatMoney(preview.bank.balance)} · app {formatMoney(preview.appBalance)} <strong style={{ color: preview.bank.balance === preview.appBalance ? "var(--green-text)" : "var(--yellow-text)" }}>{preview.bank.balance === preview.appBalance ? "✓ same" : `(${formatMoney(preview.bank.balance - preview.appBalance)} apart)`}</strong></span>}
          </div>
          {preview.newRows.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ background: "var(--group)", color: "var(--text-2)" }}>At the bank, not in the app — tick to add</div>
              {preview.newRows.map((n) => { const a = add[n.key]!; return (
                <div key={n.key} className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--border-soft)", opacity: a.on ? 1 : 0.6 }}>
                  <input type="checkbox" checked={a.on} onChange={(e) => setAdd({ ...add, [n.key]: { ...a, on: e.target.checked } })} className="m-0" />
                  <span className="text-[13px] w-14 shrink-0" style={{ color: "var(--muted)" }} title={`posted ${shortDate(n.postedDate)}`}>{shortDate(n.date)}</span>
                  <input value={a.payee} onChange={(e) => setAdd({ ...add, [n.key]: { ...a, payee: e.target.value } })} title={n.description} className="fld rounded-md px-2 text-[13px] outline-none flex-1 min-w-[10rem]" style={fieldStyle} />
                  {n.transfer ? (
                    <Select ariaLabel="Transfer to" value={a.transferToAccountId} onChange={(v) => setAdd({ ...add, [n.key]: { ...a, transferToAccountId: v, categoryId: null } })} options={acctOpts.filter((o) => o.value !== preview.account.id)} placeholder="Transfer to…" style={{ height: 32 }} className="w-48" />
                  ) : (
                    <Select ariaLabel="Category" value={a.categoryId} onChange={(v) => setAdd({ ...add, [n.key]: { ...a, categoryId: v } })} options={cats} placeholder="Category…" style={{ height: 32 }} className="w-56" menuWidth={280} />
                  )}
                  <span className="text-[13px] font-semibold w-20 text-right">{money(n.amount)}</span>
                </div>
              ); })}
            </div>
          )}
          {preview.missing.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ background: "var(--group)", color: "var(--text-2)" }}>In the app, not at the bank — tick to mark ⚠ in the ledger</div>
              {preview.missing.map((m) => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-[13px]" style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <input type="checkbox" checked={!!flag[m.id]} onChange={(e) => setFlag({ ...flag, [m.id]: e.target.checked })} className="m-0" />
                  <span className="w-14 shrink-0" style={{ color: "var(--muted)" }}>{shortDate(m.date)}</span>
                  <span className="flex-1 truncate">{m.payee ?? "—"}{m.pending && <span className="ml-2 px-1.5 rounded-full text-[10px] font-semibold" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>Pending</span>}</span>
                  <span className="font-semibold">{money(m.amount)}</span>
                </label>
              ))}
            </div>
          )}
          {preview.matched.length > 0 && <details className="text-[13px]"><summary className="cursor-pointer font-semibold" style={{ color: "var(--accent-text)" }}>{preview.matched.length} matched entries</summary><div className="flex flex-col gap-0.5 pt-1" style={{ color: "var(--text-2)" }}>{preview.matched.map((m) => <span key={m.id}>{shortDate(m.date)} · {m.payee ?? "—"} · {formatMoney(m.amount)} <em style={{ color: "var(--muted)" }}>(bank: {m.bankPayee}, {shortDate(m.bankDate)})</em></span>)}</div></details>}
          <div className="flex items-center gap-2">
            <button onClick={apply} disabled={busy} className="rounded-lg px-4 h-9 text-[13px] font-semibold disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Apply: mark {preview.matched.length} matched, add {preview.newRows.filter((n) => add[n.key]?.on).length}, flag {preview.missing.filter((m) => flag[m.id]).length}</button>
            <button onClick={() => setPreview(null)} className="rounded-lg px-3 h-9 text-[13px]" style={{ border: "1px solid var(--field)" }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Push on this device (needs the app installed to the home screen on iPhone), what to be told about, and the weekly email. */
function NotificationsSection() {
  const toast = useToast();
  const [cfg, setCfg] = useState<{ push: boolean; email: boolean; keyProblem: string | null; publicKey: string | null; devices: { id: string; label: string | null; endpoint: string }[] } | null>(null);
  const [me, setMe] = useState<{ email: string; pushRecurring?: boolean; weeklyEmail?: boolean } | null>(null);
  const [here, setHere] = useState<string | null>(null); // this browser's subscription endpoint, if any
  const [busy, setBusy] = useState(false);
  const load = async () => {
    api<typeof cfg>("/push/config").then(setCfg).catch(() => setCfg(null));
    api<typeof me>("/me").then(setMe).catch(() => {});
    try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager.getSubscription(); setHere(sub?.endpoint ?? null); } catch { setHere(null); }
  };
  useEffect(() => { load(); }, []);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const standalone = typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
  async function enable() {
    if (!cfg?.publicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Notifications were not allowed"); return; }
      const reg = await navigator.serviceWorker.ready;
      // the key is base64url; tolerate stray whitespace or quotes from copy-paste
      const raw = cfg.publicKey.replace(/[^A-Za-z0-9_-]/g, "");
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
      const key = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const j = sub.toJSON();
      const label = isIOS ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : "Computer";
      await api("/push/subscribe", { method: "POST", json: { endpoint: sub.endpoint, keys: j.keys, label } });
      toast("Notifications on for this device"); load();
    } catch (e) { toast(`Couldn't turn on notifications: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription(); if (sub) { await api("/push/subscribe", { method: "DELETE", json: { endpoint: sub.endpoint } }); await sub.unsubscribe(); } toast("Notifications off for this device"); load(); }
    finally { setBusy(false); }
  }
  const pref = async (body: object) => { await api("/me", { method: "PUT", json: body }); setMe((m) => (m ? { ...m, ...body } : m)); };
  return (
    <section id="s-notifications" className={sec} style={secStyle}>
      <h2 className="font-bold">Notifications <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>· per person</span></h2>
      {cfg?.keyProblem && <p className="text-sm rounded-lg p-3" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>{cfg.keyProblem}. Fix the value in Vercel (no quotes, nothing cut off) and redeploy.</p>}
      {!cfg ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : !cfg.push ? (
        <p className="text-sm rounded-lg p-3" style={{ background: "var(--yellow-row)", color: "var(--yellow-text)" }}>Push isn't set up on the server yet (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). See DEPLOY.md.</p>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            {here ? (
              <><span className="pill on" style={{ background: "var(--green-bg)", color: "var(--green-text)", border: "1px solid var(--green)" }}><span className="tb">✓ On for this device</span></span>
                <button onClick={() => api<{ sent: number }>("/push/test", { method: "POST" }).then((r) => toast(r.sent ? "Sent a test notification" : "No device received it"))} className="rounded-lg px-3 h-8 font-semibold" style={{ border: "1px solid var(--field)" }}>Send a test</button>
                <button onClick={disable} disabled={busy} className="rounded-lg px-3 h-8" style={{ color: "var(--muted)" }}>Turn off here</button></>
            ) : supported ? (
              <button onClick={enable} disabled={busy} className="rounded-lg px-3 h-8 font-semibold" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>{busy ? "Asking…" : "Turn on notifications on this device"}</button>
            ) : (
              <span style={{ color: "var(--muted)" }}>This browser can't receive push.</span>
            )}
          </div>
          {isIOS && !standalone && <p className="rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)", color: "var(--text-2)" }}>On iPhone, push only works once the app is on the home screen: in Safari tap Share → <strong>Add to Home Screen</strong>, open it from there, then come back to this switch.</p>}
          {cfg.devices.length > 0 && <p style={{ color: "var(--muted)" }}>Devices receiving push: {cfg.devices.map((d) => d.label ?? "device").join(", ")}.</p>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={me?.pushRecurring ?? true} onChange={(e) => pref({ pushRecurring: e.target.checked })} /> Tell me when recurring bills land and need confirming</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={me?.weeklyEmail ?? false} onChange={(e) => pref({ weeklyEmail: e.target.checked })} disabled={!cfg.email} /> Email me the Monday summary{me?.email ? ` (${me.email})` : ""}{!cfg.email && <span style={{ color: "var(--muted)" }}> — email isn't set up on the server (RESEND_API_KEY)</span>}</label>
          <p style={{ color: "var(--muted)" }}>The Monday summary also arrives as a push: Ready to Assign, what's overspent or underfunded, fun money left, bills to confirm and bills still to come.</p>
        </div>
      )}
    </section>
  );
}
