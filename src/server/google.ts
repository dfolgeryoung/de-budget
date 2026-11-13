/**
 * Google Sheets access through a service account: a signed JWT exchanged for an access token, then the REST API.
 * The key arrives as GOOGLE_SERVICE_ACCOUNT_B64 (the JSON key file, base64) and is never logged.
 */
import { createSign } from "node:crypto";

interface ServiceAccount { client_email: string; private_key: string }

let cached: { token: string; exp: number } | null = null;

export function serviceAccount(): ServiceAccount | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount; } catch { return null; }
}

export async function accessToken(scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not set");
  const now = Math.floor(Date.now() / 1000);
  const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: scopes.join(" "), aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!r.ok) throw new Error(`Google token: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Sheets API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
}

export const sheets = {
  /** cell values of a range (as the sheet shows them when `rendered`, else raw numbers/strings) */
  async get(sheetId: string, range: string, rendered = false): Promise<string[][]> {
    const q = rendered ? "valueRenderOption=FORMATTED_VALUE" : "valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING";
    const j = await call<{ values?: (string | number | boolean)[][] }>(`${sheetId}/values/${encodeURIComponent(range)}?${q}`);
    return (j.values ?? []).map((r) => r.map((v) => (v == null ? "" : String(v))));
  },
  /** write several ranges in one request; values are entered as if typed (dates and numbers parse) */
  async batchUpdate(sheetId: string, data: { range: string; values: (string | number | boolean | null)[][] }[]) {
    if (!data.length) return;
    await call(`${sheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
  },
  async clear(sheetId: string, ranges: string[]) {
    if (!ranges.length) return;
    await call(`${sheetId}/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges }) });
  },
  async tabs(sheetId: string): Promise<string[]> {
    const j = await call<{ sheets: { properties: { title: string } }[] }>(`${sheetId}?fields=sheets.properties.title`);
    return j.sheets.map((s) => s.properties.title);
  },
};

/** Copy the spreadsheet into a Drive folder (a dated backup). Needs the folder shared with the service account. */
export async function driveCopy(fileId: string, name: string, folderId: string): Promise<string> {
  const token = await accessToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [folderId] }) });
  if (!r.ok) throw new Error(`Drive copy ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()) as { id: string }).id;
}
