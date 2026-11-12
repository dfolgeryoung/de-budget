import { useEffect, useState } from "react";
import { Budget } from "./Budget";
import { Settings } from "./Settings";

const screens = [
  { id: "home", label: "Home", phoneOnly: true },
  { id: "budget", label: "Budget" },
  { id: "transactions", label: "Transactions" },
  { id: "classic", label: "Classic" },
  { id: "tracked", label: "Tracked amounts", desktopOnly: true },
  { id: "reports", label: "Reports", desktopOnly: true },
  { id: "more", label: "More", phoneOnly: true },
  { id: "settings", label: "Settings", desktopOnly: true },
] as const;

export function Shell({ me }: { me: { id: string; email: string; name: string; initial?: string; appearance?: string; showBars?: boolean } }) {
  const [screen, setScreen] = useState<string>(location.hash.slice(1) || "budget");
  useEffect(() => {
    const onHash = () => setScreen(location.hash.slice(1) || "budget");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return (
    <div className="min-h-full flex">
      {/* Desktop rail: sticky, full height; hidden on phones */}
      <nav
        aria-label="Main"
        className="hidden md:flex flex-col gap-1 w-56 p-3 sticky top-0 h-screen overflow-y-auto"
        style={{ background: "var(--rail)", color: "var(--rail-text)" }}
      >
        <div className="flex items-center gap-2 px-2 pb-4 pt-1">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: "rgba(255,255,255,0.14)" }}>🙂</div>
          <div className="min-w-0">
            <div className="font-bold text-white truncate">{me.name}</div>
            <div className="text-xs opacity-70">D&amp;E Budget</div>
          </div>
        </div>
        {screens.filter((s) => !("phoneOnly" in s)).map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="px-3 py-2 rounded-lg text-sm font-medium"
            style={screen === s.id ? { background: "rgba(255,255,255,0.14)", color: "#fff", fontWeight: 600 } : undefined}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8">
        {screen === "budget" || screen === "home" ? (
          <Budget showBars={me.showBars ?? true} />
        ) : screen === "settings" || screen === "more" ? (
          <>
            <Settings />
            <form method="post" action="/api/auth/signout" className="mt-6">
              <button className="text-sm underline" style={{ color: "var(--accent-text)" }}>Sign out ({me.email})</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold capitalize">{screen}</h1>
            <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>Coming in a later phase.</p>
          </>
        )}
      </main>

      {/* Phone bottom bar */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 h-20 flex justify-around items-start pt-2"
        style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}
      >
        {screens.filter((s) => !("desktopOnly" in s)).map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-[11px] font-medium w-16 text-center"
            style={{ color: screen === s.id ? "var(--accent-text)" : "var(--muted)", fontWeight: screen === s.id ? 600 : 500 }}
          >
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
