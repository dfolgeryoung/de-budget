import { useEffect, useState } from "react";
import { api } from "./api";

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
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-xl font-bold">Settings</h1>
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
      <MirrorSection />
      <p className="text-xs" style={{ color: "var(--muted)" }}>Accounts, categories, goals, recurring bills, tags, notifications and the rest arrive in later phases.</p>
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
