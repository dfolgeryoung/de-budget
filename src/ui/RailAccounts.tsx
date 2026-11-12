import { useEffect, useState } from "react";
import { api } from "./api";
import { formatMoney } from "../budget/money";
import type { MonthPayload } from "../server/month";

export function RailAccounts({ refreshKey, onPick, selected }: { refreshKey: number; onPick: (id: string) => void; selected: string | null }) {
  const [m, setM] = useState<MonthPayload | null>(null);
  useEffect(() => { api<MonthPayload>("/month").then(setM).catch(() => setM(null)); }, [refreshKey]);
  if (!m || !m.accounts.length) return null;
  const onBudget = m.accounts.filter((a) => a.onBudget && a.type !== "credit_card");
  const cards = m.accounts.filter((a) => a.type === "credit_card");
  const Row = ({ a }: { a: MonthPayload["accounts"][number] }) => (
    <button onClick={() => onPick(a.id)} title={`Open the ${a.name} ledger`} className={"rail-link flex justify-between items-center py-1.5 pl-2.5 pr-2 rounded-md text-left cursor-pointer" + (selected === a.id ? " on" : "")} style={selected === a.id ? { background: "rgba(255,255,255,0.14)", color: "#fff" } : undefined}>
      <span className="text-[13px] font-medium">{a.name}</span>
      {a.type === "credit_card" ? (
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={a.balance < 0 ? { background: "#FBE4E2", color: "#8C1D18" } : { background: "rgba(255,255,255,0.18)", color: "#fff" }}>{formatMoney(a.balance)}</span>
      ) : (
        <span className="text-[13px] font-semibold">{formatMoney(a.balance)}</span>
      )}
    </button>
  );
  const head = (t: string, v: number) => (
    <div className="flex justify-between items-center pt-3 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{t}</span>
      <span className="text-xs font-semibold opacity-85">{formatMoney(v)}</span>
    </div>
  );
  return (
    <div className="flex flex-col mt-2 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.92)" }}>
      {head("On budget", onBudget.reduce((s, a) => s + a.balance, 0))}
      {onBudget.map((a) => <Row key={a.id} a={a} />)}
      {head("Cards", cards.reduce((s, a) => s + a.balance, 0))}
      {cards.map((a) => <Row key={a.id} a={a} />)}
      <div className="flex flex-col mt-3 pt-2 gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
        <div className="flex justify-between text-[13px] font-semibold px-2.5"><span>Cash on budget</span><span>{formatMoney(m.view.cashOnBudget)}</span></div>
        <div className="flex justify-between text-[13px] font-semibold px-2.5"><span>Days of buffer</span><span>{Number.isFinite(m.daysOfBuffer) ? m.daysOfBuffer : "∞"}</span></div>
        <div className="flex justify-between text-[13px] font-semibold px-2.5" style={{ color: m.view.zeroCheck === 0 ? "#7EF0A5" : "#F2A09A" }}><span>Zero check</span><span>{m.view.zeroCheck === 0 ? "✓ $0.00" : formatMoney(m.view.zeroCheck)}</span></div>
      </div>
    </div>
  );
}
