/**
 * What Home says hello with. Special days win (birthdays, the anniversary, holidays); otherwise the day rotates
 * between a note about something going well, a hello in another language, and plain English. Seeded by the date so
 * it stays put all day.
 */
import type { ReportsView } from "../budget/reports";
import { monthName } from "../budget/narrative";

export interface Greeting { line: string; sub?: string; confetti?: boolean }

const PEOPLE: Record<"D" | "E", { name: string; birthday: [number, number] }> = {
  D: { name: "David", birthday: [3, 6] },
  E: { name: "Elizabeth", birthday: [9, 18] },
};
const ANNIVERSARY: [number, number] = [8, 14];

const whole = (c: number) => "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");

// ---- calendar helpers ----
const nthWeekday = (y: number, m: number, weekday: number, n: number) => { const first = new Date(y, m - 1, 1).getDay(); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7; };
const lastWeekday = (y: number, m: number, weekday: number) => { const last = new Date(y, m, 0); return last.getDate() - ((last.getDay() - weekday + 7) % 7); };
function easter(y: number): [number, number] { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function holiday(d: Date, first: string): Greeting | null {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const is = (mm: number, dd: number) => m === mm && day === dd;
  const [em, ed] = easter(y);
  if (is(1, 1)) return { line: `Happy New Year, ${first}! 🎆`, sub: "Fresh month, fresh budget." };
  if (is(2, 14)) return { line: `Happy Valentine's Day, ${first} 💝` };
  if (is(3, 17)) return { line: `Happy St. Patrick's Day, ${first} ☘️` };
  if (is(em, ed)) return { line: `Happy Easter, ${first} 🐣` };
  if (m === 5 && day === nthWeekday(y, 5, 0, 2)) return { line: `Happy Mother's Day 💐` };
  if (m === 5 && day === lastWeekday(y, 5, 1)) return { line: `Happy Memorial Day, ${first}` };
  if (m === 6 && day === nthWeekday(y, 6, 0, 3)) return { line: `Happy Father's Day 🎣` };
  if (is(7, 4)) return { line: `Happy Fourth of July, ${first} 🎇` };
  if (m === 9 && day === nthWeekday(y, 9, 1, 1)) return { line: `Happy Labor Day, ${first} 🌭` };
  if (is(10, 31)) return { line: `Happy Halloween, ${first} 🎃`, sub: "Candy counts as groceries. Probably." };
  if (m === 11 && day === nthWeekday(y, 11, 4, 4)) return { line: `Happy Thanksgiving, ${first} 🦃` };
  if (is(12, 24)) return { line: `Merry Christmas Eve, ${first} 🎄` };
  if (is(12, 25)) return { line: `Merry Christmas, ${first} 🎄` };
  if (is(12, 31)) return { line: `Happy New Year's Eve, ${first} 🥂`, sub: "Last chance to close out the year's budget." };
  return null;
}

// ---- hellos in other languages (time of day aware where the language is) ----
type Slot = "morning" | "afternoon" | "evening";
const LANGS: { lang: string; say: Record<Slot, string> }[] = [
  { lang: "French", say: { morning: "Bonjour", afternoon: "Bonjour", evening: "Bonsoir" } },
  { lang: "Spanish", say: { morning: "Buenos días", afternoon: "Buenas tardes", evening: "Buenas noches" } },
  { lang: "German", say: { morning: "Guten Morgen", afternoon: "Guten Tag", evening: "Guten Abend" } },
  { lang: "Italian", say: { morning: "Buongiorno", afternoon: "Buon pomeriggio", evening: "Buonasera" } },
  { lang: "Portuguese", say: { morning: "Bom dia", afternoon: "Boa tarde", evening: "Boa noite" } },
  { lang: "Dutch", say: { morning: "Goedemorgen", afternoon: "Goedemiddag", evening: "Goedenavond" } },
  { lang: "Swedish", say: { morning: "God morgon", afternoon: "God eftermiddag", evening: "God kväll" } },
  { lang: "Japanese", say: { morning: "Ohayō", afternoon: "Konnichiwa", evening: "Konbanwa" } },
  { lang: "Korean", say: { morning: "Annyeong", afternoon: "Annyeong", evening: "Annyeong" } },
  { lang: "Mandarin", say: { morning: "Zǎo shang hǎo", afternoon: "Nǐ hǎo", evening: "Wǎn shang hǎo" } },
  { lang: "Hindi", say: { morning: "Namaste", afternoon: "Namaste", evening: "Namaste" } },
  { lang: "Swahili", say: { morning: "Habari za asubuhi", afternoon: "Habari za mchana", evening: "Habari za jioni" } },
  { lang: "Hawaiian", say: { morning: "Aloha kakahiaka", afternoon: "Aloha ʻauinalā", evening: "Aloha ahiahi" } },
  { lang: "Greek", say: { morning: "Kaliméra", afternoon: "Kaliméra", evening: "Kalispéra" } },
  { lang: "Irish", say: { morning: "Dia dhuit", afternoon: "Dia dhuit", evening: "Dia dhuit" } },
  { lang: "Turkish", say: { morning: "Günaydın", afternoon: "İyi günler", evening: "İyi akşamlar" } },
  { lang: "Hebrew", say: { morning: "Boker tov", afternoon: "Shalom", evening: "Erev tov" } },
  { lang: "Arabic", say: { morning: "Sabah al-khair", afternoon: "Marhaba", evening: "Masa al-khair" } },
  { lang: "Polish", say: { morning: "Dzień dobry", afternoon: "Dzień dobry", evening: "Dobry wieczór" } },
  { lang: "Māori", say: { morning: "Ata mārie", afternoon: "Kia ora", evening: "Pō mārie" } },
];

// ---- things going well ----
function wins(r: ReportsView, first: string, month: string): Greeting[] {
  const out: Greeting[] = [];
  const tm = r.thisMonth;
  if (tm.toSavings > 0) out.push({ line: `${whole(tm.toSavings)} into savings this month 🏦`, sub: `Nice work, ${first} — that's money that stays.` });
  if (r.daysElapsed >= 5 && tm.onPace <= tm.budgeted) out.push({ line: `On track, ${first} 🎯`, sub: `${monthName(month)} is heading in ${tm.onPace < tm.budgeted ? `${whole(tm.budgeted - tm.onPace)} under` : "right on"} budget.` });
  if (r.daysElapsed >= 7 && tm.vsLast.pct !== null && tm.vsLast.pct < -0.08 && tm.vsLast.prevSpent > 0) out.push({ line: `Spending's down ${Math.round(-tm.vsLast.pct * 100)}% on ${monthName(r.prevMonth)} 📉`, sub: `Keep it up, ${first}.` });
  if (r.projection.headingOver.length === 0 && r.daysElapsed >= 10) out.push({ line: `Every line's on course, ${first} ✨`, sub: "Nothing is heading over budget this month." });
  if (r.daysElapsed >= 20 && tm.onPace <= tm.budgeted) out.push({ line: `Almost home, ${first} 🏁`, sub: `${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"} left and the month's still under budget.` });
  return out;
}

/** Which hello today. `now` is the person's local time. */
export function pickGreeting(now: Date, me: { first: string; initial?: string }, report: ReportsView | null, extras?: { fullyFunded?: boolean }): Greeting {
  const m = now.getMonth() + 1, day = now.getDate(), hour = now.getHours();
  const first = me.first;
  const who = (me.initial === "E" ? "E" : "D") as "D" | "E";
  const other = who === "D" ? "E" : "D";
  // 1. the two of you
  if (PEOPLE[who].birthday[0] === m && PEOPLE[who].birthday[1] === day) return { line: `Happy birthday, ${first}! 🎂`, sub: "Treat yourself — it's what fun money is for.", confetti: true };
  if (PEOPLE[other].birthday[0] === m && PEOPLE[other].birthday[1] === day) return { line: `It's ${PEOPLE[other].name}'s birthday today 🎂`, sub: `Don't forget, ${first}!`, confetti: true };
  if (ANNIVERSARY[0] === m && ANNIVERSARY[1] === day) return { line: `Happy anniversary, ${PEOPLE.D.name} & ${PEOPLE.E.name} 💍`, sub: "Here's to many more.", confetti: true };
  // 2. holidays
  const h = holiday(now, first); if (h) return h;
  // 3. a rotation seeded by the date
  const seed = now.getFullYear() * 1000 + Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86_400_000);
  const slot: Slot = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const plain = { line: `${hour < 5 ? "Up late" : slot === "morning" ? "Good morning" : slot === "afternoon" ? "Good afternoon" : "Good evening"}, ${first}` };
  const good = report ? wins(report, first, report.month) : [];
  if (extras?.fullyFunded) good.push({ line: `Next month's already paid for, ${first} 🌙`, sub: "Next month's money is fully set aside." });
  const kind = seed % 3; // 0 plain, 1 a win (else language), 2 language
  if (kind === 0) return plain;
  if (kind === 1 && good.length) return good[Math.floor(seed / 3) % good.length]!;
  const L = LANGS[Math.floor(seed / 3) % LANGS.length]!;
  return { line: `${L.say[slot]}, ${first}`, sub: `${slot === "morning" ? "Good morning" : slot === "afternoon" ? "Good afternoon" : "Good evening"} in ${L.lang}` };
}

/** A line for the budget-check card when every line is funded and nothing is overspent. */
export function allClearLine(now: Date, first: string): string {
  const lines = [
    `Every line is funded and nothing's overspent — nicely done, ${first}.`,
    "All clear. Every dollar has a job and every line's in the black.",
    "Nothing to fix here. That's the budget doing its job. 🎉",
    "Clean sheet: no overspending, nothing underfunded.",
    `Textbook month so far, ${first}. Keep going.`,
    "Not a single line needs attention. Take the win.",
  ];
  const doy = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86_400_000);
  return lines[doy % lines.length]!;
}

