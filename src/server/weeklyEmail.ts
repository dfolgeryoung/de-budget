/**
 * The Monday email: a short newsletter about the month so far — a few sentences in plain language, bar charts
 * drawn with tables (so every mail client shows them), and the lists worth a glance. Pure: takes the figures,
 * returns HTML; the numbers come from the same report the Reports screen uses.
 */
import { formatMoney } from "../budget/money.js";
import type { ReportsView } from "../budget/reports.js";
import type { MonthPayload } from "./month.js";
import { narrative, monthName } from "../budget/narrative.js";
export { narrative };

export interface WeeklyEmailInput {
  firstName: string;
  initial: "D" | "E" | string;
  people: { D: string; E: string };
  today: string;
  report: ReportsView;
  month: MonthPayload;
  pendingCount: number;
  fun: { who: "D" | "E"; name: string; available: number; weekly: number; weeksLeft: number }[];
  appUrl: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (c: number) => formatMoney(c);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const C = { navy: "#3a4f7d", text: "#1a1d23", muted: "#5b6573", faint: "#8b95a2", line: "#e6e9ee", track: "#eef1f5", bar: "#89bdec", barDark: "#3d85c6", red: "#c94b4b", green: "#2f8f5b", amber: "#b7791f", bg: "#f4f6f9", card: "#ffffff" };

/** A horizontal bar as a two-cell table: email clients honour cell widths where they ignore CSS flex. */
function bar(valuePct: number, color: string, tickPct?: number): string {
  const v = Math.max(0, Math.min(100, valuePct));
  const cell = (w: string, bg: string, radius = "") => `<td ${w ? `width="${w.replace(/width:|;/g, "")}"` : ""} style="${w}background:${bg};height:12px;${radius}font-size:0;line-height:0">&nbsp;</td>`;
  const tick = tickPct !== undefined ? Math.max(0, Math.min(100, tickPct)) : null;
  const cells = tick === null || tick <= v
    ? cell(`width:${v}%;`, color, "border-radius:6px 0 0 6px;") + cell("", C.track, "border-radius:0 6px 6px 0;")
    : cell(`width:${v}%;`, color, "border-radius:6px 0 0 6px;") + cell(`width:${Math.max(0, tick - v)}%;`, C.track) + cell("width:2px;", C.text) + cell("", C.track, "border-radius:0 6px 6px 0;");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>${cells}</tr></table>`;
}

function section(title: string, body: string, sub?: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background:${C.card};border:1px solid ${C.line};border-radius:12px;margin:0 0 14px"><tr><td style="padding:16px 18px">
    <div style="font-size:15px;font-weight:700;color:${C.text};margin:0 0 ${sub ? 2 : 10}px">${esc(title)}</div>
    ${sub ? `<div style="font-size:12px;color:${C.muted};margin:0 0 10px">${esc(sub)}</div>` : ""}
    ${body}</td></tr></table>`;
}

function tile(label: string, value: string, sub: string, color = C.text): string {
  return `<td width="33%" style="padding:0 6px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.card};border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:12px 14px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;color:${color};margin:4px 0 2px">${esc(value)}</div>
    <div style="font-size:12px;color:${C.muted}">${esc(sub)}</div></td></tr></table></td>`;
}

export function weeklyEmailHtml(input: WeeklyEmailInput): { subject: string; html: string; text: string } {
  const { report: r, month: m, people, appUrl } = input;
  const tm = r.thisMonth;
  const paragraphs = narrative(r, people, input.firstName);
  const diff = tm.onPace - tm.budgeted;

  // tiles
  const tiles = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 14px"><tr>
    ${tile("Spent so far", money(tm.spent), `of ${money(tm.budgeted)} budgeted`)}
    ${tile("On pace for", money(tm.onPace), diff > 0 ? `${money(diff)} over budget` : `${money(-diff)} under budget`, diff > 0 ? C.red : C.green)}
    ${tile(`Vs ${monthName(r.prevMonth).slice(0, 3)}`, tm.vsLast.pct === null ? "—" : `${tm.vsLast.pct >= 0 ? "+" : "−"}${Math.round(Math.abs(tm.vsLast.pct) * 100)}%`, "same day last month", tm.vsLast.pct !== null && tm.vsLast.pct > 0 ? C.red : C.green)}
  </tr></table>`;

  // spend by category: top 8, bar = spent, tick = budget, lighter extension to carry-over
  const cats = tm.byCategory.filter((c) => c.spent > 0).slice(0, 8);
  const scale = Math.max(1, ...cats.map((c) => Math.max(c.spent, c.budget)));
  const catRows = cats.map((c) => {
    const room = Math.max(c.budget, c.available), over = room > 0 ? c.spent > room : c.spent > 0;
    return `<tr><td style="padding:4px 10px 4px 0;font-size:13px;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((c.emoji ? c.emoji + " " : "") + c.name)}</td>
      <td style="padding:4px 0">${bar(pct(c.spent, scale), over ? C.red : C.bar, c.budget > 0 ? pct(c.budget, scale) : undefined)}</td>
      <td style="padding:4px 0 4px 10px;font-size:13px;font-weight:600;text-align:right;white-space:nowrap;color:${over ? C.red : C.text}">${money(c.spent)}</td></tr>`;
  }).join("");
  const categories = section("Spend by category", `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed"><colgroup><col style="width:38%"><col><col style="width:22%"></colgroup>${catRows}</table>`, "bar = spent · tick = this month's budget");

  // who spent
  const who = tm.byOwner.filter((o) => o.spent > 0);
  const whoRows = who.map((o) => {
    const color = o.who === "shared" ? C.barDark : o.who === "D" ? C.green : C.red;
    const label = o.who === "shared" ? "Shared" : people[o.who];
    return `<tr><td style="padding:4px 10px 4px 0;font-size:13px">${esc(label)}</td><td style="padding:4px 0">${bar(Math.round(o.share * 100), color)}</td><td style="padding:4px 0 4px 10px;font-size:13px;font-weight:600;text-align:right;white-space:nowrap">${money(o.spent)} <span style="color:${C.muted};font-weight:400">${Math.round(o.share * 100)}%</span></td></tr>`;
  }).join("");
  const sharedParts = tm.byOwner.find((o) => o.who === "shared")?.parts ?? [];
  const partsLine = sharedParts.length ? `<div style="font-size:12px;color:${C.muted};margin-top:8px">Shared is mostly ${sharedParts.slice(0, 4).map((p) => `${esc(p.name)} ${money(p.amount)}`).join(", ")}.</div>` : "";
  const whoSection = section("Whose spending", `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed"><colgroup><col style="width:38%"><col><col style="width:30%"></colgroup>${whoRows}</table>${partsLine}`, "by Classic line, whichever account paid");

  // fun money
  const funRows = input.fun.map((f) => `<tr><td style="padding:4px 10px 4px 0;font-size:13px;width:38%">${esc(f.name)}</td><td style="padding:4px 0 4px 0;font-size:13px;color:${C.muted}">${f.weeksLeft > 0 ? `${money(f.weekly)} a week for ${f.weeksLeft.toFixed(1)} weeks` : "month's end"}</td><td style="padding:4px 0 4px 10px;font-size:13px;font-weight:700;text-align:right;white-space:nowrap;color:${f.available < 0 ? C.red : C.text}">${money(f.available)} left</td></tr>`).join("");
  const funSection = input.fun.length ? section("Fun money", `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${funRows}</table>`) : "";

  // attention: overspent / underfunded / to confirm / RTA
  const vis = m.view.categories.filter((c) => !m.categories[c.categoryId]?.hidden);
  const name = (id: string) => `${m.categories[id]?.emoji ?? ""} ${m.categories[id]?.name ?? ""}`.trim();
  const overspent = vis.filter((c) => c.status === "overspent"), under = vis.filter((c) => c.status === "underfunded" || c.status === "not_enough");
  const attn: string[] = [];
  attn.push(m.view.readyToAssign === 0 ? `<span style="color:${C.muted}">All money assigned.</span>` : m.view.readyToAssign > 0 ? `<b style="color:${C.amber}">${money(m.view.readyToAssign)} is sitting in Ready to Assign</b> — give it a job.` : `<b style="color:${C.red}">Ready to Assign is ${money(m.view.readyToAssign)}</b> — more has been assigned than you have.`);
  if (overspent.length) attn.push(`<b style="color:${C.red}">Overspent:</b> ${overspent.map((c) => `${esc(name(c.categoryId))} ${money(c.available)}`).join(", ")}.`);
  if (under.length) attn.push(`<b style="color:${C.amber}">Underfunded:</b> ${under.map((c) => `${esc(name(c.categoryId))} by ${money(c.short)}`).join(", ")}.`);
  if (input.pendingCount) attn.push(`${input.pendingCount} recurring ${input.pendingCount === 1 ? "bill is" : "bills are"} waiting to be confirmed.`);
  if (!overspent.length && !under.length && !input.pendingCount && m.view.readyToAssign === 0) attn.push("Nothing needs attention. 🎉");
  const attention = section("Needs a look", attn.map((a) => `<div style="font-size:13px;color:${C.text};margin:0 0 6px">${a}</div>`).join(""));

  // bills still to come
  const bills = tm.billsToCome.slice(0, 8);
  const billRows = bills.map((b) => `<tr><td style="padding:3px 10px 3px 0;font-size:13px;color:${C.muted};white-space:nowrap">${b.day ? `${monthName(r.month).slice(0, 3)} ${b.day}` : "any day"}</td><td style="padding:3px 0;font-size:13px">${esc(b.payee)}</td><td style="padding:3px 0 3px 10px;font-size:13px;text-align:right;white-space:nowrap">${money(b.amount)}</td></tr>`).join("");
  const billsSection = bills.length ? section("Bills still to come", `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${billRows}<tr><td colspan="2" style="padding:6px 0 0;font-size:13px;font-weight:700;border-top:1px solid ${C.line}">Total${tm.billsToCome.length > 8 ? ` (${tm.billsToCome.length} bills)` : ""}</td><td style="padding:6px 0 0 10px;font-size:13px;font-weight:700;text-align:right;border-top:1px solid ${C.line}">${money(tm.billsTotal)}</td></tr></table>`) : "";

  const subject = `This week in the budget — ${money(tm.spent)} spent, ${diff > 0 ? `${money(diff)} over pace` : `${money(-diff)} under pace`}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg}">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.bg}"><tr><td align="center" style="padding:20px 10px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text}">
    <tr><td style="padding:6px 6px 14px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">D&amp;E Budget · ${esc(monthName(r.month))} ${r.month.slice(0, 4)}</div>
      <div style="font-size:24px;font-weight:800;color:${C.navy};margin-top:4px">This week in the budget</div>
    </td></tr>
    <tr><td style="padding:0 6px 14px">${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 10px">${esc(p)}</p>`).join("")}</td></tr>
    <tr><td>${tiles}</td></tr>
    <tr><td style="padding:0 6px">${categories}${whoSection}${funSection}${attention}${billsSection}</td></tr>
    <tr><td align="center" style="padding:6px 6px 20px"><a href="${esc(appUrl)}" style="display:inline-block;background:${C.navy};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">Open the budget</a>
      <div style="font-size:11px;color:${C.faint};margin-top:14px">Sent every Monday by your budget app. Turn it off under Settings › Notifications &amp; phone.</div></td></tr>
  </table></td></tr></table></body></html>`;
  const text = [...paragraphs, "", ...attn.map((a) => a.replace(/<[^>]+>/g, "")), "", ...bills.map((b) => `${b.day ? `${b.day}: ` : ""}${b.payee} ${money(b.amount)}`)].join("\n");
  return { subject, html, text };
}
