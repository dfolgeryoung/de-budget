import { useState } from "react";

export function Settings() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const r = await fetch("/api/import/sheet", { method: "POST", headers: { "content-type": "text/plain" }, body: text });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(j.error ?? r.statusText));
      setResult(
        `Imported ${j.transactions} entries (${j.lines} lines), ${j.categories} categories in ${j.groups} groups, ${j.accounts} accounts, ` +
          `${j.assignments} assigned amounts, ${j.goals} goals, ${j.recurring} recurring bills. First month ${j.firstMonth}; live months ${(j.months as string[]).join(", ")}.`,
      );
    } catch (e) {
      setResult(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-xl font-bold">Settings</h1>
      <section className="rounded-xl p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="font-bold">Import from the spreadsheet</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Drop the budget's text export (the file with "## Sheet name:" sections). It loads accounts, categories and groups, goals,
          assigned amounts, every ledger entry, recurring bills and the Jul–Oct history, and records the sheet's own figures so the
          Budget screen can check itself against them. Running it again replaces what came from the sheet; entries made in the app are kept.
        </p>
        <label className="inline-flex items-center gap-3 text-sm font-semibold rounded-lg px-4 py-3 cursor-pointer w-fit" style={{ background: "var(--navy)", color: "var(--navy-text)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Importing…" : "Choose export file"}
          <input type="file" accept=".txt,.csv,text/plain" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {result && (
          <p className="text-sm rounded-lg p-3" style={{ background: result.startsWith("Import failed") ? "var(--red-bg)" : "var(--green-bg)", color: result.startsWith("Import failed") ? "var(--red-text)" : "var(--green-text)" }}>
            {result}
          </p>
        )}
      </section>
      <p className="text-xs" style={{ color: "var(--muted)" }}>Accounts, categories, goals, recurring bills, tags, notifications and the rest arrive in later phases.</p>
    </div>
  );
}
