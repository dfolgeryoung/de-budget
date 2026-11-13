import { useEffect, useState } from "react";
import { api } from "./api";
import { Select } from "./Select";
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
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Shared settings change the budget for both of you; the ones marked "per person" only change your own app.</p>
      </div>
      <nav aria-label="Settings sections" className="no-bar flex gap-2 overflow-x-auto pb-1 text-[13px] font-semibold">
        {[["accounts", "Accounts"], ["categories", "Categories & groups"], ["appearance", "Appearance & profile"], ["import", "Import"], ["mirror", "Sheet mirror"]].map(([id, label]) => <a key={id} href={`#settings/${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="pill" style={{ background: "var(--card)", color: "var(--text-2)", border: "1px solid var(--field)" }}><span className="tb">{label}</span></a>)}
      </nav>
      <AccountsSection />
      <CategoriesSection />
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
      <p className="text-xs" style={{ color: "var(--muted)" }}>Recurring bills, tags management, tracked amounts, payees, notifications and the home-screen layout arrive in later phases.</p>
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
const sec = "rounded-xl p-5 flex flex-col gap-3";
const secStyle = { background: "var(--card)", border: "1px solid var(--border)" } as const;
const fieldStyle = { height: 32, border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;
const refreshApp = () => dispatchEvent(new Event("lists-changed"));

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
  return (
    <section id="s-accounts" className={sec} style={secStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h2 className="font-bold">Accounts</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Type decides where an account shows; owner drives the Classic columns and the 50/50 rule; off-budget accounts don't feed Ready to Assign.</p></div>
        <button onClick={() => setAdding((v) => !v)} className="rounded-lg px-3 h-8 text-[13px] font-semibold shrink-0" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>+ Account</button>
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
          <input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="Account name" className="fld rounded-md px-2 text-[13px] outline-none w-44" style={fieldStyle} />
          <Select ariaLabel="Type" value={n.type} onChange={(v) => setN({ ...n, type: (v as typeof n.type) ?? "checking" })} options={[{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }, { value: "credit_card", label: "Credit card" }]} style={{ height: 32 }} />
          <Select ariaLabel="Owner" value={n.owner} onChange={(v) => setN({ ...n, owner: (v as typeof n.owner) ?? "shared" })} options={[{ value: "D", label: "David" }, { value: "E", label: "Elizabeth" }, { value: "shared", label: "Shared" }]} style={{ height: 32 }} />
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={n.onBudget} onChange={(e) => setN({ ...n, onBudget: e.target.checked })} /> On budget</label>
          <span className="flex items-center rounded-md px-2 w-32" style={fieldStyle}><span style={{ color: "var(--muted)" }}>$</span><input value={n.startingBalance} onChange={(e) => setN({ ...n, startingBalance: e.target.value })} placeholder="starting" inputMode="decimal" className="w-full min-w-0 bg-transparent outline-none text-right text-[13px]" /></span>
          <input type="date" value={n.startingDate} onChange={(e) => setN({ ...n, startingDate: e.target.value })} className="fld rounded-md px-2 text-[13px] outline-none" style={fieldStyle} />
          <button onClick={async () => { try { await api("/accounts", { method: "POST", json: { ...n, startingBalance: parseMoney(n.startingBalance) ?? 0 } }); setAdding(false); setN({ ...n, name: "", startingBalance: "" }); load(); refreshApp(); toast(`Added ${n.name}`); } catch (e) { toast((e as Error).message); } }} disabled={!n.name.trim()} className="rounded-md px-3 h-8 text-[13px] font-semibold disabled:opacity-50" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Add</button>
        </div>
      )}
      {!all ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : (
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
                  <TextCell value={c.emoji ?? ""} onSave={(emoji) => put(c.id, { emoji })} className="text-center" placeholder="🙂" />
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
      <p className="text-xs" style={{ color: "var(--muted)" }}>Hidden categories stay out of the budget and auto-assign but keep their history. Classic rules: By account (payer's Fun Money, shared account → Misc shared), Utilities split (Power / Utilities by payer), Phone split (Internet keyword → Internet, else Cell Phone), Drive split (by payer).</p>
    </section>
  );
}

function AppearanceSection() {
  const toast = useToast();
  const [me, setMe] = useState<{ avatarEmoji?: string; appearance?: string; showBars?: boolean } | null>(null);
  useEffect(() => { api<{ avatarEmoji?: string; appearance?: string; showBars?: boolean }>("/me").then(setMe).catch(() => setMe(null)); }, []);
  const save = async (body: object) => { try { await api("/me", { method: "PUT", json: body }); setMe((m) => ({ ...m, ...body })); dispatchEvent(new Event("me-changed")); } catch (e) { toast(`Not saved: ${(e as Error).message}`); } };
  return (
    <section id="s-appearance" className={sec} style={secStyle}>
      <h2 className="font-bold">Appearance & profile <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>· per person</span></h2>
      {!me ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p> : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
          <span className="flex items-center gap-2">Avatar <span className="text-xs" style={{ color: "var(--muted)" }}>— click your picture at the top of the rail (or on More on the phone) to change it</span></span>
          <label className="flex items-center gap-2">Theme <Select ariaLabel="Theme" value={me.appearance ?? "system"} onChange={(v) => save({ appearance: v ?? "system" })} options={[{ value: "system", label: "Match the device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} style={{ height: 32 }} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={me.showBars ?? true} onChange={(e) => save({ showBars: e.target.checked })} /> Show progress bars by default</label>
        </div>
      )}
    </section>
  );
}
