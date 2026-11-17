import { describe, it, expect } from "vitest";
import { pickGreeting, allClearLine } from "../src/ui/greeting";

const at = (iso: string) => new Date(iso);
describe("greetings", () => {
  it("birthdays and the anniversary come with confetti", () => {
    expect(pickGreeting(at("2027-03-06T09:00"), { first: "David", initial: "D" }, null)).toMatchObject({ line: "Happy birthday, David! 🎂", confetti: true });
    expect(pickGreeting(at("2027-03-06T09:00"), { first: "Elizabeth", initial: "E" }, null).line).toBe("It's David's birthday today 🎂");
    expect(pickGreeting(at("2027-09-18T20:00"), { first: "Elizabeth", initial: "E" }, null)).toMatchObject({ line: "Happy birthday, Elizabeth! 🎂", confetti: true });
    expect(pickGreeting(at("2027-08-14T12:00"), { first: "David", initial: "D" }, null).confetti).toBe(true);
  });
  it("knows the moving holidays", () => {
    expect(pickGreeting(at("2026-11-26T09:00"), { first: "David" }, null).line).toContain("Thanksgiving");
    expect(pickGreeting(at("2027-03-28T09:00"), { first: "David" }, null).line).toContain("Easter");
    expect(pickGreeting(at("2027-05-09T09:00"), { first: "David" }, null).line).toContain("Mother's Day");
    expect(pickGreeting(at("2026-12-25T09:00"), { first: "David" }, null).line).toContain("Christmas");
  });
  it("ordinary days rotate between plain, a win and another language, and stay put all day", () => {
    const kinds = new Set<string>();
    for (let d = 1; d <= 12; d++) {
      const g = pickGreeting(at(`2026-11-${String(d).padStart(2, "0")}T10:00`), { first: "David" }, null);
      const again = pickGreeting(at(`2026-11-${String(d).padStart(2, "0")}T11:30`), { first: "David" }, null);
      expect(again.line).toBe(g.line);
      kinds.add(g.sub?.includes(" in ") ? "lang" : g.line.startsWith("Good") ? "plain" : "other");
    }
    expect(kinds.has("lang")).toBe(true); expect(kinds.has("plain")).toBe(true);
  });
  it("evening greetings in other languages are evening greetings", () => {
    for (let d = 1; d <= 60; d++) {
      const g = pickGreeting(new Date(2026, 0, d, 20), { first: "David" }, null);
      if (g.sub?.includes("in French")) expect(g.line.startsWith("Bonsoir")).toBe(true);
      if (g.sub?.includes("in Spanish")) expect(g.line.startsWith("Buenas noches")).toBe(true);
    }
  });
  it("all-clear lines rotate by day", () => {
    expect(allClearLine(at("2026-11-16T10:00"), "David")).not.toBe(allClearLine(at("2026-11-17T10:00"), "David"));
  });
});
