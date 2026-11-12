import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Toast { id: number; text: string; undo?: () => Promise<void> | void }
const Ctx = createContext<(text: string, undo?: () => Promise<void> | void) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, undo?: () => Promise<void> | void) => {
    const id = ++n.current;
    setToasts((ts) => [...ts, { id, text, undo }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 8000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed left-4 right-4 md:left-auto md:right-6 md:w-96 flex flex-col gap-2 z-50" style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}>
        {toasts.map((t) => <ToastItem key={t.id} t={t} close={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} />)}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ t, close }: { t: Toast; close: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const h = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(h); }, []);
  return (
    <div className="rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3 shadow-lg transition-all duration-200" style={{ background: "#1A1D23", color: "#fff", transform: shown ? "translateY(0)" : "translateY(12px)", opacity: shown ? 1 : 0 }}>
      <span>{t.text}</span>
      {t.undo && <button className="font-semibold" style={{ color: "#8FC7FF" }} onClick={async () => { await t.undo!(); close(); }}>Undo</button>}
    </div>
  );
}
