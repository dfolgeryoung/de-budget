/** When a recurring bill falls due. Monthly bills have a day of the month; interval bills repeat every N days from an anchor date. */
import { daysInMonth, type ISODate, type MonthKey } from "./dates.js";

export interface Schedule { dayOfMonth: number | null; everyDays: number | null; anchorDate: ISODate | null }

const addDays = (iso: ISODate, n: number): ISODate => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a: ISODate, b: ISODate) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

export const isInterval = (s: Schedule): s is Schedule & { everyDays: number; anchorDate: ISODate } => !!s.everyDays && s.everyDays > 0 && !!s.anchorDate;

/** The due dates of a bill inside one month, in order (a 28-day bill lands twice in some months; a monthly bill once). */
export function dueDatesInMonth(s: Schedule, month: MonthKey): ISODate[] {
  const ym = month.slice(0, 7), dim = daysInMonth(month);
  if (isInterval(s)) {
    const first = `${ym}-01`, last = `${ym}-${String(dim).padStart(2, "0")}`;
    // step from the anchor to the first due date on or after the 1st, then collect through the last day
    const k0 = Math.ceil(diffDays(s.anchorDate, first) / s.everyDays);
    const out: ISODate[] = [];
    for (let k = k0; ; k++) { const d = addDays(s.anchorDate, k * s.everyDays); if (d > last) break; if (d >= first) out.push(d); }
    return out;
  }
  return [`${ym}-${String(Math.min(s.dayOfMonth ?? 1, dim)).padStart(2, "0")}`];
}

/** Due dates that have arrived by `today` (this month) and haven't been landed yet. */
export function dueNow(s: Schedule, today: ISODate, lastCreatedDate: ISODate | null, lastCreatedMonth: MonthKey | null): ISODate[] {
  const month = today.slice(0, 7) + "-01";
  if (isInterval(s)) return dueDatesInMonth(s, month).filter((d) => d <= today && (!lastCreatedDate || d > lastCreatedDate));
  if (lastCreatedMonth && lastCreatedMonth >= month) return [];
  return dueDatesInMonth(s, month).filter((d) => d <= today);
}

/** The next due date on or after `from`. */
export function nextDue(s: Schedule, from: ISODate): ISODate | null {
  const month = from.slice(0, 7) + "-01";
  const here = dueDatesInMonth(s, month).find((d) => d >= from);
  if (here) return here;
  const d = new Date(month + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1);
  return dueDatesInMonth(s, d.toISOString().slice(0, 10))[0] ?? null;
}

/** For "bills still to come": the day of the month of the bill's next due date in `month` on or after `from` (null when none left). */
export function dayStillToCome(s: Schedule, month: MonthKey, from: ISODate): number | null {
  const d = dueDatesInMonth(s, month).find((x) => x >= from);
  return d ? Number(d.slice(8, 10)) : null;
}
