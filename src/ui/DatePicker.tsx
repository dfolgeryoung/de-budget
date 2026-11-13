import { useEffect, useRef, useState } from "react";
import { Popover } from "./Select";
import { Calendar, Chevron } from "./icons";
import { daysInMonth } from "../budget/dates";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** An app-drawn month calendar behind a small calendar button; picks a date in ISO form. */
export function DatePicker({ value, today, onChange }: { value: string; today: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) });
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }); }, [open, value]);
  const shift = (n: number) => setView((v) => { const d = new Date(v.y, v.m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const first = new Date(view.y, view.m - 1, 1).getDay();
  const n = daysInMonth(`${view.y}-${String(view.m).padStart(2, "0")}-01`);
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const pick = (d: number) => { onChange(iso(view.y, view.m, d)); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" aria-label="Pick a date" title="Pick a date" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-7 h-full inline-flex items-center justify-center shrink-0 rounded-r-md" style={{ color: open ? "var(--accent-text)" : "var(--muted)" }}>
        <Calendar />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={252}>
        {() => (
          <div className="p-2.5 select-none" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <div className="flex items-center justify-between mb-1.5">
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="w-7 h-7 rounded-md inline-flex items-center justify-center tb-btn" style={{ color: "var(--muted)" }}><Chevron dir="left" size={13} /></button>
              <span className="text-[13px] font-semibold">{MONTHS[view.m - 1]} {view.y}</span>
              <button type="button" aria-label="Next month" onClick={() => shift(1)} className="w-7 h-7 rounded-md inline-flex items-center justify-center tb-btn" style={{ color: "var(--muted)" }}><Chevron dir="right" size={13} /></button>
            </div>
            <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>{DOW.map((d) => <span key={d} className="h-6 leading-6">{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((d, i) => {
                if (!d) return <span key={i} />;
                const k = iso(view.y, view.m, d), sel = k === value, isToday = k === today;
                return (
                  <button key={i} type="button" onClick={() => pick(d)} className="h-8 w-8 mx-auto rounded-full text-[13px] tb-btn inline-flex items-center justify-center"
                    style={sel ? { background: "var(--navy)", color: "var(--navy-text)", fontWeight: 700 } : isToday ? { boxShadow: "inset 0 0 0 1.5px var(--accent-text)", color: "var(--accent-text)", fontWeight: 600 } : undefined}>{d}</button>
                );
              })}
            </div>
            <div className="flex justify-between items-center pt-2 mt-1.5 text-xs" style={{ borderTop: "1px solid var(--border-soft)" }}>
              <button type="button" onClick={() => { onChange(today); setOpen(false); }} className="font-semibold tb-btn rounded px-1.5 py-0.5" style={{ color: "var(--accent-text)" }}>Today</button>
              <span style={{ color: "var(--muted)" }}>Type "11/3", "nov 3" or "yesterday" too</span>
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
