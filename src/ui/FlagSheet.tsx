import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { formatMoney } from "../budget/money";
import type { FlagNote } from "../server/flags";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => { const d = new Date(iso); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`; };

/** The thread on one entry: ask a question, reply, resolve. Opens from the ledger row menu, the entry editor and the Home card. */
export function FlagSheet({ entry, meId, open, onClose, onChanged }: { entry: { id: string; payee: string | null; amount: number | null; date: string; flagOpen?: boolean }; meId: string; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [notes, setNotes] = useState<FlagNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(!!entry.flagOpen);
  const box = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  useEffect(() => { if (!open) return; setNotes(null); setIsOpen(!!entry.flagOpen); api<{ notes: FlagNote[] }>(`/transactions/${entry.id}/notes`).then((r) => setNotes(r.notes)).catch(() => setNotes([])); setTimeout(() => box.current?.focus({ preventScroll: true }), 320); }, [open, entry.id, entry.flagOpen]);
  if (!open) return null;
  async function send() {
    const v = text.trim(); if (!v) return;
    setBusy(true);
    try { const r = await api<{ notes: FlagNote[] }>(`/transactions/${entry.id}/notes`, { method: "POST", json: { text: v } }); setNotes(r.notes); setText(""); setIsOpen(true); onChanged(); toast(notes?.length ? "Reply sent" : "Flagged — they'll see it on Home"); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  async function setFlag(v: boolean) {
    setBusy(true);
    try { await api(`/transactions/${entry.id}/flag`, { method: "PUT", json: { open: v } }); setIsOpen(v); onChanged(); toast(v ? "Reopened" : "Resolved"); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="font-bold text-base m-0">🚩 {notes?.length ? "Flagged entry" : "Flag this entry"}</h2><div className="text-xs truncate" style={{ color: "var(--muted)" }}>{entry.payee || "(no payee)"} · {entry.amount === null ? "—" : formatMoney(entry.amount)} · {entry.date}</div></div>
          {isOpen && <span className="px-2 rounded-full text-[11px] font-semibold leading-5 shrink-0" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>open</span>}
        </div>
        <div className="flex flex-col gap-2">
          {notes === null ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Loading…</p> : notes.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Ask a question or leave a note about this entry. The other of you will see it on Home and get a push.</p> : notes.map((n) => (
            <div key={n.id} className="rounded-xl px-3 py-2" style={{ background: n.userId === meId ? "var(--selected)" : "var(--group)", alignSelf: n.userId === meId ? "flex-end" : "flex-start", maxWidth: "88%" }}>
              <div className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{n.userId === meId ? "You" : n.who} · {when(n.at)}</div>
              <div className="text-sm whitespace-pre-wrap">{n.text}</div>
            </div>
          ))}
        </div>
        <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} placeholder={notes?.length ? "Reply…" : "What was this for?"} rows={3} className="fld rounded-xl px-3 py-2 text-[16px] outline-none w-full" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)", resize: "vertical" }} />
        <div className="flex items-center justify-between gap-2">
          {notes?.length ? <button onClick={() => setFlag(!isOpen)} disabled={busy} className="rounded-lg px-3 h-10 text-[13px] font-semibold disabled:opacity-50" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>{isOpen ? "✓ Resolve" : "Reopen"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 h-10 text-[14px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Close</button>
            <button onClick={send} disabled={busy || !text.trim()} className="rounded-lg px-5 h-10 text-[14px] font-semibold disabled:opacity-50" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>{notes?.length ? "Reply" : "Flag"}</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
