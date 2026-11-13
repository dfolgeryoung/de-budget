import { useState } from "react";
import { api } from "./api";
import { parseMoney } from "../budget/money";
import { Select } from "./Select";
import { EmojiButton } from "./EmojiPicker";
import { useToast } from "./Toast";
import type { MonthPayload } from "../server/month";
import { monthLabel } from "./Budget";

/** New category: name, emoji, group, and (optionally) a goal that applies from the month being viewed. */
export function AddCategory({ data, onDone }: { data: MonthPayload; onDone: () => void }) {
  const groups = data.groups.filter((g) => !g.system);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [groupId, setGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const [type, setType] = useState<"refill_to" | "set_aside">("refill_to");
  const [amount, setAmount] = useState("");
  const [every, setEvery] = useState("1");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const field = { height: 40, border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;
  async function save() {
    if (!name.trim()) return toast("Give the category a name");
    if (!groupId) return toast("Pick a group");
    const cents = parseMoney(amount);
    setBusy(true);
    try {
      await api("/categories", { method: "POST", json: { name: name.trim(), emoji: emoji.trim() || null, groupId, goal: cents && cents > 0 ? { validFrom: data.month, type, amount: cents, frequencyMonths: Math.max(1, Number(every) || 1), targetDate: null } : undefined } });
      toast(`Added ${emoji.trim() ? emoji.trim() + " " : ""}${name.trim()}`);
      onDone();
    } catch (e) { toast(`Not added: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-4 md:pt-0">
      <h2 className="text-lg font-bold">New category</h2>
      <div className="flex gap-2">
        <EmojiButton value={emoji} onPick={setEmoji} size={40} className="rounded-lg" />
        <input autoFocus aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Category name" className="fld flex-1 rounded-lg px-3 text-[15px] outline-none" style={field} />
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-medium" style={{ color: "var(--muted)" }}>Group
        <Select ariaLabel="Group" value={groupId} onChange={setGroupId} options={groups.map((g) => ({ value: g.id, label: g.name }))} className="w-full" style={{ height: 40, borderRadius: 8, fontSize: "calc(15px * var(--fs))" }} />
      </label>
      <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Goal from {monthLabel(data.month)} (optional)</div>
        <div className="flex gap-2">
          <Select ariaLabel="Goal type" value={type} onChange={(v) => setType((v as "refill_to" | "set_aside") ?? "refill_to")} options={[{ value: "refill_to", label: "Refill up to" }, { value: "set_aside", label: "Set aside another" }]} className="flex-1" style={{ height: 36, borderRadius: 8 }} />
          <span className="flex items-center rounded-lg px-2.5 w-32" style={{ ...field, height: 36 }}><span style={{ color: "var(--muted)" }}>$</span><input aria-label="Goal amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full min-w-0 bg-transparent outline-none text-right" /></span>
        </div>
        <div className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--muted)" }}>every <input aria-label="Months" value={every} onChange={(e) => setEvery(e.target.value)} inputMode="numeric" className="fld w-12 rounded-lg px-2 text-center outline-none" style={{ ...field, height: 32 }} /> month{Number(every) === 1 ? "" : "s"}</div>
      </div>
      <button onClick={save} disabled={busy} className="rounded-xl py-3 text-[15px] font-semibold disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>{busy ? "Adding…" : "Add category"}</button>
    </div>
  );
}
