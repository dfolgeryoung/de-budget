import { useEffect, useRef, useState, type ReactNode } from "react";

/** Bottom sheet on the phone, side panel on desktop; slides in, dims the page, closes on backdrop tap, Escape, or dragging the handle down. */
export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ y: number; moving: boolean } | null>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  useEffect(() => {
    const h = requestAnimationFrame(() => setOpen(true));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(h); removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [onClose]);

  // Drag the handle down to dismiss: follows the finger, closes past 110px or on a quick flick, otherwise springs back.
  const onDown = (e: React.PointerEvent) => { start.current = { y: e.clientY, t: performance.now() }; (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ y: 0, moving: true }); };
  const onMove = (e: React.PointerEvent) => { if (!start.current) return; setDrag({ y: Math.max(0, e.clientY - start.current.y), moving: true }); };
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y, dt = performance.now() - start.current.t;
    start.current = null;
    if (dy > 110 || (dy > 30 && dy / dt > 0.6)) { setOpen(false); setDrag(null); setTimeout(onClose, 200); }
    else setDrag({ y: 0, moving: false });
  };
  const transform = !open ? "translate(0, 100%)" : drag ? `translate(0, ${drag.y}px)` : "translate(0,0)";
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-stretch md:justify-end" onClick={onClose} style={{ background: `rgba(20,28,40,${open ? 0.55 : 0})`, transition: "background 200ms" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:w-[440px] max-h-[92vh] md:max-h-none md:h-full overflow-y-auto rounded-t-[22px] md:rounded-none px-5 pb-8 md:p-6 pt-0 md:pt-6"
        style={{ background: "var(--card)", color: "var(--text)", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)", transform, transition: drag?.moving ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)", paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
      >
        {/* the grab handle: a full-width, 28px-tall touch target that stays put while the sheet scrolls */}
        <div role="button" aria-label="Drag down to close" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="sticky top-0 z-10 -mx-5 px-5 h-7 flex items-center justify-center md:hidden cursor-grab active:cursor-grabbing" style={{ background: "var(--card)", touchAction: "none" }}>
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--field)" }} />
        </div>
        <div className="md:hidden h-1" />
        {children}
      </div>
    </div>
  );
}
