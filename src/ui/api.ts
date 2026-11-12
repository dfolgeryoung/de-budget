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
