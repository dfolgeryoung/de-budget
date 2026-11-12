import { useEffect, useState } from "react";
import { Budget } from "./Budget";
import { Settings } from "./Settings";
import { Transactions, EntrySheet, emptyDraft } from "./Transactions";
import type { EntryDraft } from "./EntryForm";
import { api, type Lists } from "./api";
import { ToastHost, useToast } from "./Toast";
import { RailAccounts } from "./RailAccounts";
import { Home } from "./Home";
import { Classic } from "./Classic";
import { NavIcon } from "./icons";

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

type Me = { id: string; email: string; name: string; initial?: string; appearance?: string; showBars?: boolean; avatarEmoji?: string };

export function Shell({ me }: { me: Me }) {
  return (
    <ToastHost>
      <ShellInner me={me} />
    </ToastHost>
  );
}

function ShellInner({ me }: { me: Me }) {
  const isPhone = typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;
  const [screen, setScreen] = useState<string>(location.hash.slice(1) || (isPhone ? "home" : "budget"));
  const [lists, setLists] = useState<Lists | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [account, setAccount] = useState<string | null>(null);
  const toast = useToast();
  const loadLists = () => api<Lists>("/lists").then(setLists).catch((e) => toast(String(e)));
  useEffect(() => {
    const onHash = () => setScreen(location.hash.slice(1) || "budget");
    addEventListener("hashchange", onHash);
    addEventListener("lists-changed", loadLists);
    loadLists();
    return () => { removeEventListener("hashchange", onHash); removeEventListener("lists-changed", loadLists); };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", me.appearance ?? "system");
  }, [me.appearance]);
  const openNew = () => lists && setDraft(emptyDraft(lists, me, screen === "transactions" ? account ?? undefined : undefined));
  const onSaved = (_id: string, summary: string) => { setDraft(null); setRefreshKey((k) => k + 1); loadLists(); toast(summary); };
  return (
    <div className="min-h-full flex">
      {/* Desktop rail: sticky, full height; hidden on phones */}
      <nav
        aria-label="Main"
        className="hidden md:flex flex-col gap-1 w-56 p-3 sticky top-0 h-screen overflow-y-auto"
        style={{ background: "var(--rail)", color: "var(--rail-text)" }}
      >
        <div className="flex items-center gap-2 px-2 pb-4 pt-1">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)" }}>{me.avatarEmoji ?? "🙂"}</div>
          <div className="min-w-0">
            <div className="font-bold text-white truncate">{me.name}</div>
            <div className="text-xs opacity-70">D&amp;E Budget</div>
          </div>
        </div>
        {screens.filter((s) => !("phoneOnly" in s)).map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={screen === s.id ? { background: "rgba(255,255,255,0.14)", color: "#fff", fontWeight: 600 } : undefined}
          >
            <span className="inline-flex shrink-0" style={{ opacity: screen === s.id ? 1 : 0.8 }}><NavIcon id={s.id} size={18} /></span>
            {s.label}
          </a>
        ))}
        <RailAccounts refreshKey={refreshKey} selected={screen === "transactions" ? account : null} onPick={(id) => { setAccount(id); location.hash = "transactions"; }} />
      </nav>

      <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8" style={(screen === "home" || screen === "budget" || screen === "transactions" || screen === "classic") && isPhone ? { paddingTop: 0 } : undefined}>
        {screen === "home" && lists ? (
          <Home me={me} lists={lists} refreshKey={refreshKey} goTransactions={(id) => { setAccount(id); location.hash = "transactions"; }} />
        ) : screen === "budget" || screen === "home" ? (
          <Budget me={me} showBarsDefault={me.showBars ?? true} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
        ) : screen === "transactions" && lists ? (
          <Transactions me={me} lists={lists} openEntry={setDraft} refreshKey={refreshKey} account={account} setAccount={setAccount} />
        ) : screen === "classic" ? (
          <Classic refreshKey={refreshKey} openEntry={isPhone ? undefined : openNew} />
        ) : screen === "settings" || screen === "more" ? (
          <>
            {isPhone && (
              <div className="flex items-center gap-3 rounded-xl p-4 mb-4" style={{ background: "var(--rail)", color: "#fff" }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)" }}>{me.avatarEmoji ?? "🙂"}</div>
                <div className="min-w-0"><div className="font-bold truncate">{me.name}</div><div className="text-xs opacity-75 truncate">{me.email}</div></div>
              </div>
            )}
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

      {/* Add entry: floating button on the phone; on desktop the ledger has the entry row */}
      <button onClick={openNew} aria-label="Add entry" className="fixed right-5 w-14 h-14 rounded-full text-3xl font-medium z-30 md:hidden" style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))", background: "var(--navy)", color: "var(--navy-text)", boxShadow: "0 6px 16px rgba(30,58,95,0.35)" }}>+</button>
      {lists && <EntrySheet lists={lists} me={me} draft={draft} onClose={() => setDraft(null)} onSaved={onSaved} onDeleted={() => setRefreshKey((k) => k + 1)} />}

      {/* Phone bottom bar */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 flex justify-around items-start pt-2.5"
        style={{ background: "var(--card)", borderTop: "1px solid var(--border)", height: "calc(78px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {screens.filter((s) => !("desktopOnly" in s)).map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="flex flex-col items-center gap-[3px] text-[11px] w-16 text-center"
            style={{ color: screen === s.id ? "var(--accent-text)" : "var(--muted)", fontWeight: screen === s.id ? 600 : 500 }}
          >
            <NavIcon id={s.id} />
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
