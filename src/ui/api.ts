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
  accounts: { id: string; name: string; type: string; owner: string }[];
  groups: { id: string; name: string; system: boolean; categories: { id: string; name: string; emoji: string | null; kind: string; favourite: number | null }[] }[];
  payees: { name: string; lastCategoryId: string | null; lastAccountId: string | null }[];
  tags: { id: string; name: string; color: string }[];
  tracked: { id: string; name: string; emoji: string | null }[];
}

/**
 * Category options for a dropdown: Ready to Assign (when income is allowed), then the pinned categories in their
 * pinned order under "Pinned", then everything else by group. Card-payment categories are never pickable.
 */
export function categoryOptions(lists: Lists, opts: { income?: boolean; all?: boolean } = {}): { value: string; label: string; group?: string }[] {
  const label = (c: { name: string; emoji: string | null }) => `${c.emoji ? c.emoji + " " : ""}${c.name}`;
  const groups = opts.all ? lists.groups : lists.groups.filter((g) => !g.system || g.name === "One Month Ahead");
  const pickable = groups.flatMap((g) => g.categories.filter((c) => opts.all || c.kind !== "card_payment").map((c) => ({ ...c, groupName: g.name })));
  const pinned = pickable.filter((c) => c.favourite !== null).sort((a, b) => a.favourite! - b.favourite!);
  const pinnedIds = new Set(pinned.map((c) => c.id));
  return [
    ...(opts.income ? [{ value: "rta", label: "Ready to Assign (income)", group: "Income" }] : []),
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
