/**
 * Backups go to Google Drive *as one of you*, not as the service account: service accounts have no Drive storage
 * quota, so they can't own files. One of you connects Drive once (OAuth, drive.file scope — the app only sees files it
 * made); the refresh token lives in settings and the nightly job uses it. The app keeps its own "D&E Budget backups"
 * folder in that person's My Drive.
 */
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { accessToken, serviceAccount } from "./google.js";

const KEY = "drive_oauth";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "D&E Budget backups";

export interface DriveLink { refreshToken: string; email: string; connectedBy: string; connectedAt: string; folderId?: string }

function appUrl(): string { return (process.env.AUTH_URL ?? "").replace(/\/$/, ""); }
export const redirectUri = () => `${appUrl()}/api/drive/callback`;

async function link(db: Db): Promise<DriveLink | null> {
  const row = (await db.select().from(t.settings).where(eq(t.settings.key, KEY)))[0];
  return (row?.value as DriveLink | undefined) ?? null;
}
async function saveLink(db: Db, v: DriveLink | null) {
  if (!v) { await db.delete(t.settings).where(eq(t.settings.key, KEY)); return; }
  await db.insert(t.settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: t.settings.key, set: { value: v, updatedAt: new Date() } });
}

/** Where backups will go, for the settings screen. */
export async function driveStatus(db: Db): Promise<{ mode: "user" | "service" | "off"; email?: string; folderUrl?: string; connectedBy?: string }> {
  const l = await link(db);
  if (l) return { mode: "user", email: l.email, connectedBy: l.connectedBy, folderUrl: l.folderId ? `https://drive.google.com/drive/folders/${l.folderId}` : undefined };
  if (process.env.BACKUP_FOLDER_ID && serviceAccount()) return { mode: "service", folderUrl: `https://drive.google.com/drive/folders/${process.env.BACKUP_FOLDER_ID}` };
  return { mode: "off" };
}

// ---- OAuth dance ----
const sign = (s: string) => createHmac("sha256", process.env.AUTH_SECRET ?? "dev").update(s).digest("base64url");

export function connectUrl(userId: string): string {
  const nonce = randomBytes(8).toString("base64url");
  const state = `${userId}.${nonce}.${sign(`${userId}.${nonce}`)}`;
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri(), response_type: "code", scope: `${SCOPE} email`, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function finishConnect(db: Db, userId: string, code: string, state: string): Promise<DriveLink> {
  const [uid, nonce, sig] = state.split(".");
  if (uid !== userId || !nonce || sign(`${uid}.${nonce}`) !== sig) throw new Error("That sign-in link doesn't match this session");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: redirectUri(), grant_type: "authorization_code" }) });
  if (!r.ok) throw new Error(`Google token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!j.refresh_token) throw new Error("Google didn't return a refresh token — remove the app under myaccount.google.com › Security › Third-party access and connect again");
  const who = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${j.access_token}` } });
  const email = who.ok ? ((await who.json()) as { email?: string }).email ?? "" : "";
  const v: DriveLink = { refreshToken: j.refresh_token, email, connectedBy: userId, connectedAt: new Date().toISOString() };
  userToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  v.folderId = await ensureFolder(j.access_token, undefined);
  await saveLink(db, v);
  return v;
}

export async function disconnect(db: Db): Promise<void> {
  const l = await link(db);
  if (l) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(l.refreshToken)}`, { method: "POST" }); } catch { /* best effort */ } }
  userToken = null;
  await saveLink(db, null);
}

// ---- tokens and the folder ----
let userToken: { token: string; exp: number } | null = null;

async function refreshUser(l: DriveLink): Promise<string> {
  if (userToken && userToken.exp > Date.now() + 60_000) return userToken.token;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: l.refreshToken, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", grant_type: "refresh_token" }) });
  if (!r.ok) throw new Error(`Drive access expired (${r.status}) — reconnect Google Drive under Settings › Backup. ${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  userToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return userToken.token;
}

async function ensureFolder(token: string, folderId: string | undefined): Promise<string> {
  if (folderId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,trashed`, { headers: { authorization: `Bearer ${token}` } });
    if (r.ok && !((await r.json()) as { trashed?: boolean }).trashed) return folderId;
  }
  const q = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { authorization: `Bearer ${token}` } });
  const existing = found.ok ? ((await found.json()) as { files: { id: string }[] }).files[0] : undefined;
  if (existing) return existing.id;
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) });
  if (!r.ok) throw new Error(`Drive folder ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { id: string }).id;
}

/** The token and folder to use for backups: the connected person's Drive, else the service account + BACKUP_FOLDER_ID. */
export async function backupTarget(db: Db): Promise<{ token: string; folderId: string; mode: "user" | "service" } | { skipped: string }> {
  const l = await link(db);
  if (l) {
    const token = await refreshUser(l);
    const folderId = await ensureFolder(token, l.folderId);
    if (folderId !== l.folderId) await saveLink(db, { ...l, folderId });
    return { token, folderId, mode: "user" };
  }
  if (process.env.BACKUP_FOLDER_ID && serviceAccount()) return { token: await accessToken(), folderId: process.env.BACKUP_FOLDER_ID, mode: "service" };
  return { skipped: "Google Drive isn't connected — connect it under Settings › Backup & restore" };
}
