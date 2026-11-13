import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Popover } from "./Select";

type Group = [name: string, emojis: [emoji: string, name: string][]];
let cache: Group[] | null = null;
const load = async (): Promise<Group[]> => cache ?? (cache = (await import("./emojiData.json")).default as Group[]);

/** A searchable grid of every emoji, anchored to a button; picks one. */
export function EmojiPicker({ anchor, open, onClose, onPick }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(cache);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { load().then(setGroups); setQ(""); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  const shown = useMemo(() => {
    if (!groups) return [];
    const s = q.trim().toLowerCase();
    if (!s) return groups;
    return groups.map(([g, es]) => [g, es.filter(([, n]) => n.includes(s))] as Group).filter(([, es]) => es.length);
  }, [groups, q]);
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={336}>
      {(maxH) => (
        <div className="flex flex-col" style={{ maxHeight: Math.min(420, maxH) }}>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji…" className="m-2 mb-1 px-2.5 text-[13px] rounded-md outline-none" style={{ height: 32, border: "1px solid var(--field)", background: "var(--card-alt)", color: "var(--text)" }} onKeyDown={(e) => { if (e.key === "Enter") { const first = shown[0]?.[1][0]; if (first) { onPick(first[0]); onClose(); } } }} />
          <div className="overflow-y-auto px-2 pb-2">
            {!groups && <div className="text-xs p-2" style={{ color: "var(--muted)" }}>Loading…</div>}
            {shown.length === 0 && groups && <div className="text-xs p-2" style={{ color: "var(--muted)" }}>No emoji match "{q}"</div>}
            {shown.map(([g, es]) => (
              <div key={g}>
                <div className="px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{g}</div>
                <div className="grid" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
                  {es.map(([e, n]) => <button key={e} type="button" title={n} onClick={() => { onPick(e); onClose(); }} className="h-9 rounded-md text-[22px] leading-none inline-flex items-center justify-center tb-btn">{e}</button>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** A small button showing the current emoji that opens the picker. */
export function EmojiButton({ value, onPick, size = 32, className = "", placeholder = "🙂" }: { value: string | null | undefined; onPick: (e: string) => void; size?: number; className?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" aria-label="Choose an emoji" title="Choose an emoji" onClick={() => setOpen((o) => !o)} className={"fld inline-flex items-center justify-center rounded-md shrink-0 " + className} style={{ width: size, height: size, border: "1px solid var(--field)", background: "var(--card)", fontSize: size * 0.55, color: value ? "var(--text)" : "var(--faint)" }}>{value || placeholder}</button>
      <EmojiPicker anchor={btn} open={open} onClose={() => setOpen(false)} onPick={onPick} />
    </>
  );
}
