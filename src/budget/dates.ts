/** Month keys are "YYYY-MM-01" strings; dates are "YYYY-MM-DD". No Date objects in the engine. */

export type MonthKey = string; // YYYY-MM-01
export type ISODate = string; // YYYY-MM-DD

export const monthOf = (d: ISODate): MonthKey => `${d.slice(0, 7)}-01`;

export function addMonths(m: MonthKey, n: number): MonthKey {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mo / 12);
  const mm = ((mo % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

export const monthsBetween = (a: MonthKey, b: MonthKey): number =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

export function daysInMonth(m: MonthKey): number {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export const dayOf = (d: ISODate): number => Number(d.slice(8, 10));

/** Weeks left in the month including today, as a fraction (days left / 7). */
export function weeksLeft(today: ISODate): number {
  const m = monthOf(today);
  return (daysInMonth(m) - dayOf(today) + 1) / 7;
}

/**
 * Parse what a person types in a date box: 11/11, 11-11, 11.11, 1111, "Nov 11",
 * "November 11", "11 nov", "11", "t", "y", "+1", "-2", 2026-11-11, 11/11/2026.
 * Returns an ISO date or null.
 */
export function parseTypedDate(input: string, today: ISODate): ISODate | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  };
  const shift = (n: number) => new Date(Date.UTC(ty, tm - 1, td + n)).toISOString().slice(0, 10);
  if (s === "t" || s === "today") return today;
  if (s === "y" || s === "yesterday") return shift(-1);
  if (/^[+-]\d{1,3}$/.test(s)) return shift(Number(s));
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return iso(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2,4})$/))) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return iso(y, +m[1]!, +m[2]!);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIdx = (w: string) => months.findIndex((x) => w.startsWith(x));
  const guessYear = (mo: number, d: number) => {
    // a month-day well in the future is taken as last year (typing 12/28 in early January)
    const cand = iso(ty, mo, d);
    if (!cand) return null;
    const diffDays = (Date.UTC(ty, mo - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000;
    return diffDays > 45 ? iso(ty - 1, mo, d) : cand;
  };
  if ((m = s.match(/^(\d{1,2})[\/.\- ]?(\d{1,2})$/)) && s.length >= 3) {
    const mo = +m[1]!, d = +m[2]!;
    if (mo >= 1 && mo <= 12) return guessYear(mo, d);
  }
  if ((m = s.match(/^([a-z]{3,9})\.?\s*(\d{1,2})(?:,?\s*(\d{4}))?$/))) {
    const mo = monthIdx(m[1]!) + 1;
    if (mo > 0) return m[3] ? iso(+m[3], mo, +m[2]!) : guessYear(mo, +m[2]!);
  }
  if ((m = s.match(/^(\d{1,2})\s*([a-z]{3,9})\.?(?:,?\s*(\d{4}))?$/))) {
    const mo = monthIdx(m[2]!) + 1;
    if (mo > 0) return m[3] ? iso(+m[3], mo, +m[1]!) : guessYear(mo, +m[1]!);
  }
  if (/^\d{1,2}$/.test(s)) return iso(ty, tm, +s);
  return null;
}
