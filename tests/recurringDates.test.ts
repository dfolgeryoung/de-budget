import { describe, it, expect } from "vitest";
import { dueDatesInMonth, dueNow, nextDue, dayStillToCome } from "../src/budget/recurringDates";

const nyt = { dayOfMonth: null, everyDays: 28, anchorDate: "2026-10-27" }; // The New York Times: every four weeks
const monthly = { dayOfMonth: 15, everyDays: null, anchorDate: null };

describe("every-N-days bills", () => {
  it("land every 28 days from the anchor, twice in some months", () => {
    expect(dueDatesInMonth(nyt, "2026-11-01")).toEqual(["2026-11-24"]);
    expect(dueDatesInMonth(nyt, "2026-12-01")).toEqual(["2026-12-22"]);
    expect(dueDatesInMonth(nyt, "2027-01-01")).toEqual(["2027-01-19"]);
    expect(dueDatesInMonth(nyt, "2026-09-01")).toEqual(["2026-09-01", "2026-09-29"]); // twice: 56 and 28 days before the anchor
    expect(dueDatesInMonth(nyt, "2026-10-01")).toEqual(["2026-10-27"]);
  });
  it("only what has arrived and hasn't been landed is due now", () => {
    expect(dueNow(nyt, "2026-11-13", null, null)).toEqual([]);
    expect(dueNow(nyt, "2026-11-24", null, null)).toEqual(["2026-11-24"]);
    expect(dueNow(nyt, "2026-11-25", "2026-11-24", null)).toEqual([]);
    expect(dueNow(nyt, "2026-09-30", "2026-09-01", null)).toEqual(["2026-09-29"]);
  });
  it("knows the next due date and the day still to come this month", () => {
    expect(nextDue(nyt, "2026-11-13")).toBe("2026-11-24");
    expect(nextDue(nyt, "2026-11-25")).toBe("2026-12-22");
    expect(dayStillToCome(nyt, "2026-11-01", "2026-11-13")).toBe(24);
    expect(dayStillToCome(nyt, "2026-11-01", "2026-11-25")).toBeNull();
  });
});

describe("monthly bills", () => {
  it("land on their day, clamped to the month's length", () => {
    expect(dueDatesInMonth({ ...monthly, dayOfMonth: 31 }, "2026-11-01")).toEqual(["2026-11-30"]);
    expect(dueNow(monthly, "2026-11-13", null, null)).toEqual([]);
    expect(dueNow(monthly, "2026-11-15", null, null)).toEqual(["2026-11-15"]);
    expect(dueNow(monthly, "2026-11-20", null, "2026-11-01")).toEqual([]);
    expect(nextDue(monthly, "2026-11-16")).toBe("2026-12-15");
  });
});
