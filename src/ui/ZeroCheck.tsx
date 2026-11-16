import { useEffect, useState } from "react";
import { api } from "./api";
import { Sheet } from "./Sheet";
import { formatMoney } from "../budget/money";
import { goToTransactions } from "./Reports";
import type { ZeroCheckPayload } from "../server/month";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** What the zero check is, and — when it isn't zero — which entries knocked it off and how to put each one right. */
export function ZeroCheckSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const [d, setD] = useState<ZeroCheckPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<ZeroCheckPayload>(`/zero-check/${month}`).then(setD).catch((e) => setErr((e as Error).message)); }, [month]);
  const ok = d?.zeroCheck === 0;
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-bold text-base m-0">Zero check {d ? <span style={{ color: ok ? "var(--green-text)" : "var(--red-text)" }}>{ok ? "✓ $0.00" : formatMoney(d.zeroCheck)}</span> : null}</h2>
          <p className="text-xs m-0 mt-1" style={{ color: "var(--muted)" }}>Cash on budget minus everything that cash is spoken for (every category's Available plus Ready to Assign). It must be zero: every dollar in the on-budget accounts has exactly one job.</p>
        </div>
        {err && <p className="text-sm m-0" style={{ color: "var(--red-text)" }}>{err}</p>}
        {d === null && !err && <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Looking…</p>}
        {d && ok && <p className="text-sm m-0">All good — nothing to fix.</p>}
        {d && !ok && d.causes.length === 0 && <p className="text-sm m-0">No single entry explains it. The usual cause is an account's starting balance not matching the category balances it was imported with — compare the first month's Ready to Assign with the sheet.</p>}
        {d && d.causes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>{d.causes.length === 1 ? "One entry explains it" : `${d.causes.length} entries explain it`}</div>
            {d.causes.map((c) => (
              <div key={c.transactionId + c.effect} className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: "var(--group)" }}>
                <div className="flex justify-between gap-3 text-sm"><span className="font-semibold truncate">{c.payee || "(no payee)"} · {md(c.date)} · {c.account}</span><span className="tabular-nums shrink-0" style={{ color: "var(--red-text)" }}>{formatMoney(c.effect)}</span></div>
                <div className="text-[13px]">{c.why}</div>
                <div className="text-[13px] rounded-lg px-2.5 py-1.5" style={{ background: "var(--card)", border: "1px solid var(--border-soft)" }}><strong>Fix:</strong> {c.fix}</div>
                <button onClick={() => { onClose(); goToTransactions({ month: c.date.slice(0, 7) + "-01", open: c.transactionId }); }} className="self-start text-[12px] font-semibold" style={{ color: "var(--accent-text)" }}>Open this entry ›</button>
              </div>
            ))}
            {d.unexplained !== 0 && <p className="text-[13px] m-0" style={{ color: "var(--muted)" }}>That leaves {formatMoney(d.unexplained)} unexplained — usually starting balances vs the opening category balances from the import.</p>}
          </div>
        )}
        <div className="flex justify-end"><button onClick={onClose} className="rounded-lg px-4 h-10 text-[14px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Close</button></div>
      </div>
    </Sheet>
  );
}
