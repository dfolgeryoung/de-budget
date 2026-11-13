/** The weekly summary: what the month looks like right now, sent by push and (optionally) email each Monday. */
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { monthPayload } from "./month.js";
import { pending } from "./recurring.js";
import { pushToUser, sendEmail } from "./notify.js";
import { formatMoney } from "../budget/money.js";

export async function weeklySummary(db: Db, today: string) {
  const m = await monthPayload(db, today.slice(0, 7) + "-01", today);
  const cats = m.view.categories.filter((c) => !m.categories[c.categoryId]?.hidden);
  const overspent = cats.filter((c) => c.status === "overspent");
  const under = cats.filter((c) => c.status === "underfunded" || c.status === "not_enough");
  const name = (id: string) => `${m.categories[id]?.emoji ?? ""} ${m.categories[id]?.name ?? ""}`.trim();
  const pend = await pending(db);
  const funs = cats.filter((c) => /fun money/i.test(m.categories[c.categoryId]?.name ?? ""));
  const lines = [
    `Ready to Assign ${formatMoney(m.view.readyToAssign)} · buffer ${Number.isFinite(m.daysOfBuffer) ? m.daysOfBuffer + " days" : "∞"}`,
    overspent.length ? `Overspent: ${overspent.map((c) => `${name(c.categoryId)} ${formatMoney(c.available)}`).join(", ")}` : "Nothing overspent",
    under.length ? `Underfunded: ${under.map((c) => `${name(c.categoryId)} by ${formatMoney(c.short)}`).join(", ")}` : "Everything funded",
    ...funs.map((c) => `${name(c.categoryId)}: ${formatMoney(c.available)} left`),
    pend.length ? `${pend.length} recurring ${pend.length === 1 ? "bill" : "bills"} waiting to be confirmed` : "",
    m.billsToCome.length ? `Still to come: ${m.billsToCome.map((b) => `${b.payee} ${formatMoney(Math.abs(b.amount))}`).join(", ")}` : "",
  ].filter(Boolean);
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2 style="color:#3a4f7d">This week in the budget</h2>${lines.map((l) => `<p style="margin:6px 0">${l}</p>`).join("")}<p><a href="${process.env.AUTH_URL ?? ""}">Open the budget</a></p></div>`;
  const users = await db.select().from(t.users);
  const sent: Record<string, { push: number; email: boolean }> = {};
  for (const u of users) {
    const push = await pushToUser(db, u.id, { title: "This week in the budget", body: lines.slice(0, 3).join(" · "), url: "/#home", tag: "weekly" });
    const email = u.weeklyEmail ? await sendEmail(u.email, "This week in the budget", html) : false;
    sent[u.initial] = { push, email };
  }
  return { text, sent };
}
