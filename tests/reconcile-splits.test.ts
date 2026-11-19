import { describe, it, expect } from "vitest";
import { matchBank } from "../src/server/reconcile";
import { parseBankCsv } from "../src/budget/bankCsv";

const csv = `"Checking","******6105"
"Balance as of 11/19/2026","3442.450000"
"Date","Account","Account Number","Account Type","Description","Check #","Category","Memo","Credit","Debit"
"11/18/2026","Checking","******6105","Checking","ACH DEBIT VENMO            PAYMENT 026322008766392 (Venmo)","","Financial Services/P2P Payment","","","-40.00"
"11/18/2026","Checking","******6105","Checking","INTERNET CREDIT TRANSFER DEBIT FROM DD ******4212 11/18 14.10 #00032203145810261 (INTERNET CREDIT TRANSFER DEBIT FROM DD  ****4212)","","Financial Services/Transfers","","60.00",""
"11/12/2026","Checking","******6105","Checking","ACH DEBIT VENMO            PAYMENT 026316004151745 (Venmo)","","Financial Services/P2P Payment","","","-35.00"
"11/12/2026","Checking","******6105","Checking","ACH DEPOSIT VENMO            CASHOUT 026316004163611 (Venmo)","","Financial Services/P2P Payment","","40.00",""
"11/09/2026","Checking","******6105","Checking","ACH DEBIT VENMO            PAYMENT 026313001828984 (Venmo)","","Financial Services/P2P Payment","","","-125.00"
"11/12/2026","Checking","******6105","Checking","POINT OF SALE DEBIT L343 VENMO *ELIZABETH YOUNNEW YORK   NY (Venmo)","","Financial Services/P2P Payment","","","-20.00"
`;

describe("reconciling a 50/50 household", () => {
  const file = parseBankCsv(csv);
  const mine = [
    { id: "helms", date: "2026-11-08", payee: "Helms boys", confirmed: true, seen: -12500 }, // split: bank sees the full 125
    { id: "piano", date: "2026-11-17", payee: "Piano", confirmed: true, seen: -4000 },
    { id: "cash", date: "2026-11-13", payee: "Venmo cashout", confirmed: true, seen: 2000 },
  ];
  const r = matchBank(file.rows, mine, [], "2026-11-01", "2026-11-19", { name: "Elizabeth", last4: ["4212"], oneChecking: true });
  it("matches split entries by their full amount", () => {
    expect(r.matched.map((m) => m.id).sort()).toEqual(["helms", "piano"]);
  });
  it("sets transfers and Venmo between the two of you apart as settlements", () => {
    expect(r.settlements.map((s) => s.amount).sort((a, b) => a - b)).toEqual([-2000, 6000]);
    expect(r.newRows.map((n) => n.amount)).not.toContain(6000);
  });
  it("flags a bank row whose amount differs from a nearby entry instead of calling it new", () => {
    const cash = r.newRows.find((n) => n.amount === 4000)!;
    expect(cash.near?.id).toBe("cash");
    expect(r.newRows.find((n) => n.amount === -3500)?.near).toBeUndefined();
  });
});
