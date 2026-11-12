/** Money is integer cents everywhere. These helpers keep the edges honest. */

export type Cents = number;

export function parseMoney(input: string): Cents | null {
  const s = input.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1").replace("−", "-");
  if (!/^-?\d*(\.\d{0,2})?$/.test(s) || s === "" || s === "-" || s === ".") return null;
  const neg = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

export function formatMoney(cents: Cents, opts: { sign?: boolean; dollar?: boolean } = {}): string {
  const { sign = true, dollar = true } = opts;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const body = `${dollar ? "$" : ""}${whole}.${frac}`;
  if (cents < 0 && sign) return `−${body}`;
  return body;
}

export const sum = (xs: Iterable<Cents>): Cents => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};
