import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Chevron } from "./icons";

/**
 * A floating panel anchored under (or above) an element. position:fixed so it escapes overflow-hidden cards;
 * closes on outside click, scroll, resize or Escape.
 */
export function Popover({ anchor, open, onClose, width = 220, children, panelRef }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; width?: number; children: (maxH: number) => ReactNode; panelRef?: RefObject<HTMLDivElement | null> }) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? own;
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) { setPos(null); return; }
    const r = anchor.current.getBoundingClientRect();
    const w = Math.max(r.width, width);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    if (below >= 240 || below >= above) setPos({ top: r.bottom + 4, left, width: w, maxH: Math.min(720, below) });
    else setPos({ bottom: window.innerHeight - r.top + 4, left, width: w, maxH: Math.min(720, above) });
  }, [open, anchor, width]);
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose(); };
    const scroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down); window.addEventListener("scroll", scroll, true); window.addEventListener("resize", scroll); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); document.removeEventListener("keydown", key); };
  }, [open, onClose, anchor, ref]);
  if (!open || !pos) return null;
  return (
    <div ref={ref} tabIndex={-1} className="fixed z-50 flex flex-col rounded-lg outline-none overflow-hidden"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 28px rgba(0,0,0,0.16)", color: "var(--text)" }}>
      {children(pos.maxH)}
    </div>
  );
}

export interface SelectOption { value: string; label: string; group?: string; hint?: string }

/**
 * A dropdown drawn by the app rather than the browser, so the open list matches the rest of the UI
 * (the native <select> menu can't be styled). Keyboard: arrows, Enter, Escape; type to filter long lists.
 */
export function Select({ value, onChange, options, placeholder = "Choose…", pill = false, on = false, className = "", style, menuWidth, searchable, ariaLabel, prefix }: {
  value: string | null; onChange: (v: string | null) => void; options: SelectOption[]; placeholder?: string;
  pill?: boolean; on?: boolean; className?: string; style?: React.CSSProperties; menuWidth?: number; searchable?: boolean; ariaLabel?: string; prefix?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const canSearch = searchable ?? options.length > 7;
  const current = options.find((o) => o.value === (value ?? "")) ?? null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || (o.group ?? "").toLowerCase().includes(s)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    setQ(""); setHi(Math.max(0, options.findIndex((o) => o.value === (value ?? ""))));
    requestAnimationFrame(() => (canSearch ? search.current : panel.current)?.focus());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { panel.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi, open]);

  function pick(v: string | null) { onChange(v === "" ? null : v); setOpen(false); btn.current?.focus(); }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[hi]; if (o) pick(o.value); }
    else if (e.key === "Tab") setOpen(false);
  }

  const trig = pill
    ? { paddingRight: 10, background: on ? "var(--navy)" : "var(--card)", color: on ? "var(--navy-text)" : "var(--text-2)", border: `1px solid ${on ? "var(--navy)" : "var(--field)"}` }
    : { height: 34, padding: "0 8px 0 10px", borderRadius: 6, fontSize: 13, background: "var(--card)", color: current ? "var(--text)" : "var(--faint)", border: "1px solid var(--field)" };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}
        className={(pill ? "pill " + (on ? "on " : "") : "fld inline-flex items-center gap-1.5 ") + "min-w-0 outline-none " + className} style={{ ...trig, ...style }}>
        {prefix}
        <span className="tb truncate flex-1 text-left leading-none">{current ? current.label : placeholder}</span>
        <Chevron dir="down" size={pill ? 12 : 14} className="shrink-0" style={{ opacity: 0.7, transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={menuWidth} panelRef={panel}>
        {(maxH) => (
          <div role="listbox" onKeyDown={onKey} className="flex flex-col">
            {canSearch && (
              <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter…" className="m-2 mb-1 px-2.5 text-[13px] rounded-md outline-none" style={{ height: 32, border: "1px solid var(--field)", background: "var(--card-alt)", color: "var(--text)" }} />
            )}
            <div className="overflow-y-auto py-1" style={{ maxHeight: maxH - (canSearch ? 44 : 0) }}>
              {filtered.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>No matches</div>}
              {filtered.map((o, i) => {
                const header = o.group && o.group !== lastGroup ? o.group : null; lastGroup = o.group;
                const sel = o.value === (value ?? "");
                return (
                  <div key={o.value + i}>
                    {header && <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{header}</div>}
                    <div data-i={i} role="option" aria-selected={sel} onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}
                      className="flex items-center gap-2 px-3 cursor-pointer text-[13px]" style={{ height: 32, background: i === hi ? "var(--selected)" : undefined, color: sel ? "var(--accent-text)" : "var(--text)", fontWeight: sel ? 600 : 400 }}>
                      <span className="truncate flex-1">{o.label}</span>
                      {o.hint && <span className="text-[11px] shrink-0" style={{ color: "var(--muted)" }}>{o.hint}</span>}
                      {sel && <span aria-hidden="true" className="text-xs">✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
