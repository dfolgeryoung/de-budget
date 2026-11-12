import { useEffect, useState, type ReactNode } from "react";

/** Bottom sheet on the phone, side panel on desktop; slides in, dims the page, closes on backdrop tap or Escape. */
export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = requestAnimationFrame(() => setOpen(true));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(h); removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-stretch md:justify-end" onClick={onClose} style={{ background: `rgba(20,28,40,${open ? 0.55 : 0})`, transition: "background 200ms" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:w-[440px] max-h-[92vh] md:max-h-none md:h-full overflow-y-auto rounded-t-[22px] md:rounded-none p-5 pb-8 md:p-6"
        style={{ background: "var(--card)", color: "var(--text)", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)", transform: open ? "translate(0,0)" : "translate(0, 100%)", transition: "transform 220ms cubic-bezier(0.22,1,0.36,1)", paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-3 md:hidden" style={{ background: "var(--field)" }} />
        {children}
      </div>
    </div>
  );
}
