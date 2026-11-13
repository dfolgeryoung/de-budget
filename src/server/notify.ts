/**
 * Notifications: web push (VAPID) to each person's subscribed devices, and email through Resend when a key is set.
 * Both are optional: without the env vars the functions simply report "not configured".
 */
import webpush from "web-push";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";

const clean = (k: string | undefined) => (k ?? "").replace(/[^A-Za-z0-9_-]/g, "");
export const vapidPublic = () => clean(process.env.VAPID_PUBLIC_KEY);
export function pushConfigured(): boolean { return !!(vapidPublic() && clean(process.env.VAPID_PRIVATE_KEY)); }
export function emailConfigured(): boolean { return !!process.env.RESEND_API_KEY; }

function setup() {
  webpush.setVapidDetails((process.env.VAPID_SUBJECT || "mailto:budget@example.com").trim(), vapidPublic(), clean(process.env.VAPID_PRIVATE_KEY));
}

/** Send a push to every device of a user; dead subscriptions are removed. */
export async function pushToUser(db: Db, userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  if (!pushConfigured()) return 0;
  setup();
  const subs = await db.select().from(t.pushSubscriptions).where(eq(t.pushSubscriptions.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 60 * 60 * 12 }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.id, s.id)); }
  }
  return sent;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM || "D&E Budget <budget@resend.dev>", to, subject, html }) });
  return r.ok;
}
