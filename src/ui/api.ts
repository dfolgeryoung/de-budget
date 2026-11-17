export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(`/api${path}`, { ...rest, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? r.statusText);
  return body as T;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface Lists {
  accounts: { id: string; name: string; type: string; owner: string; onBudget?: boolean }[];
  groups: { id: string; name: string; system: boolean; categories: { id: string; name: string; emoji: string | null; kind: string; favourite: number | null }[] }[];
  payees: { name: string; lastCategoryId: string | null; lastAccountId: string | null }[];
  tags: { id: string; name: string; color: string }[];
  tracked: { id: string; name: string; emoji: string | null }[];
}

/**
 * Category options for a dropdown: Ready to Assign (when income is allowed), then the pinned categories in their
 * pinned order under "Pinned", then everything else by group. Card-payment categories are never pickable.
 */
export function categoryOptions(lists: Lists, opts: { income?: boolean; all?: boolean; offBudget?: boolean } = {}): { value: string; label: string; group?: string }[] {
  const label = (c: { name: string; emoji: string | null }) => `${c.emoji ? c.emoji + " " : ""}${c.name}`;
  const groups = opts.all ? lists.groups : lists.groups.filter((g) => !g.system || g.name === "One Month Ahead");
  const pickable = groups.flatMap((g) => g.categories.filter((c) => opts.all || c.kind !== "card_payment").map((c) => ({ ...c, groupName: g.name })));
  const pinned = pickable.filter((c) => c.favourite !== null).sort((a, b) => a.favourite! - b.favourite!);
  const pinnedIds = new Set(pinned.map((c) => c.id));
  return [
    ...(opts.income ? [opts.offBudget ? { value: "rta", label: "No category (off-budget account)", group: "Off budget" } : { value: "rta", label: "Ready to Assign (income)", group: "Income" }] : []),
    ...pinned.map((c) => ({ value: c.id, label: label(c), group: "Pinned" })),
    ...pickable.filter((c) => !pinnedIds.has(c.id)).map((c) => ({ value: c.id, label: label(c), group: c.groupName })),
  ];
}

/** Create a tag (or get the existing one with that name) and tell the shell to reload its lists. */
export async function createTag(name: string): Promise<{ id: string; name: string; color: string }> {
  const r = await api<{ tag: { id: string; name: string; color: string } }>("/tags", { method: "POST", json: { name } });
  dispatchEvent(new Event("lists-changed"));
  return r.tag;
}

/** The phone's bottom bar: four screens of the person's choosing (Settings › Phone menu), then More. */
export const PHONE_NAV_OPTIONS = [["home", "Home"], ["budget", "Budget"], ["transactions", "Transactions"], ["classic", "Classic"], ["reports", "Reports"], ["tracked", "Tracked amounts"]] as const;
export const DEFAULT_PHONE_NAV = ["home", "budget", "transactions", "classic"];

/** Dark or light text for a tag chip, from its background's luminance. */
export function tagText(bg: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
  if (!m) return "#1A1D23";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55 ? "#1A1D23" : "#ffffff";
}

// ---------- cached-first loading ----------
// A screen's last payload is kept on the device (keyed to the signed-in person) and shown at once on the next open,
// then replaced as soon as the server answers. Only GET payloads go through here; edits always wait for the server.
let cacheUser = "";
export function setCacheUser(id: string) { cacheUser = id; }
export function clearCache() { try { for (const k of Object.keys(localStorage)) if (k.startsWith("cache:")) localStorage.removeItem(k); } catch { /* storage off */ } }
let inflight = 0;
// announced a tick later: screens start loading in the same commit that mounts the shell's listener
const syncing = (delta: number) => { inflight += delta; queueMicrotask(() => dispatchEvent(new CustomEvent("syncing", { detail: inflight > 0 }))); };
export function apiCached<T>(path: string, apply: (data: T, fresh: boolean) => void): Promise<void> {
  const key = `cache:${cacheUser}:${path}`;
  let hadCached = false;
  try { const raw = localStorage.getItem(key); if (raw) { apply((JSON.parse(raw) as { data: T }).data, false); hadCached = true; } } catch { /* ignore a bad entry */ }
  if (hadCached) syncing(1);
  return api<T>(path)
    .then((d) => {
      const entry = JSON.stringify({ at: Date.now(), data: d });
      try { localStorage.setItem(key, entry); } catch { clearCache(); try { localStorage.setItem(key, entry); } catch { /* storage off */ } } // over quota: start the cache afresh
      apply(d, true);
    })
    .finally(() => { if (hadCached) syncing(-1); });
}
/** When the cached copy of a path was stored, for an "updated … ago" note. */
export function cachedAt(path: string): number | null {
  try { const raw = localStorage.getItem(`cache:${cacheUser}:${path}`); return raw ? (JSON.parse(raw) as { at: number }).at : null; } catch { return null; }
}
