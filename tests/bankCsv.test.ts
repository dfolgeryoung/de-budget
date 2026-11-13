import { describe, it, expect } from "vitest";
import { parseBankCsv, cleanPayee, purchaseDate } from "../src/budget/bankCsv";

// made-up rows in the bank's layout (two preamble lines, header, rows, totals)
const sample = `"Checking","******0000"
"Balance as of 11/12/2026","1234.560000"
"Date","Account","Account Number","Account Type","Description","Check #","Category","Memo","Credit","Debit"
"11/10/2026","Checking","******0000","Checking","ACH DEBIT POWERCO          BILL PAY 026313002096889 (Power Co)","","Utilities/Gas and Electric","","","-208.24"
"11/09/2026","Checking","******0000","Checking","INTERNET DEBIT TRANSFER CREDIT TO  DD ******1111 11/08 18.23 #00031204183323242 (INTERNET DEBIT TRANSFER CREDIT TO DD  ****1111)","","Financial Services/Transfers","","","-12.50"
"11/09/2026","Checking","******0000","Checking","POINT OF SALE DEBIT L340 DATE 11-07 SQ *CORNER CAFE RALEIGH (Corner Cafe Raleigh)","","Food & Drink/Dining Out","","","-8.58"
"11/06/2026","Checking","******0000","Checking","ACH DEPOSIT EMPLOYER INC       ACH 026310000626739 (EMPLOYER INC ACH)","","Income/Payroll","","2950.00",""
"","","","","","","Totals:","4 items","2950.00","-229.32"
`;

describe("bank csv", () => {
  it("parses the preamble, rows, dates and amounts", () => {
    const f = parseBankCsv(sample);
    expect(f.balance).toBe(123456); expect(f.asOf).toBe("2026-11-12"); expect(f.account).toContain("Checking");
    expect(f.rows.map((r) => [r.date, r.postedDate, r.payee, r.amount, r.transfer])).toEqual([
      ["2026-11-10", "2026-11-10", "Power Co", -20824, false],
      ["2026-11-09", "2026-11-09", "INTERNET DEBIT TRANSFER CREDIT TO DD ****1111", -1250, true],
      ["2026-11-07", "2026-11-09", "Corner Cafe Raleigh", -858, false],
      ["2026-11-06", "2026-11-06", "EMPLOYER INC ACH", 295000, false],
    ]);
  });
  it("cleans payees without a bracketed name and handles year roll-over", () => {
    expect(cleanPayee("POINT OF SALE DEBIT L340 DATE 11-07 SQ *CORNER CAFE RALEIGH")).toBe("SQ *CORNER CAFE RALEIGH");
    expect(purchaseDate("POINT OF SALE DEBIT DATE 12-30 X", "2027-01-02")).toBe("2026-12-30");
  });
  it("accepts a plain Date / Description / Amount file", () => {
    const f = parseBankCsv("Date,Description,Amount\n2026-11-01,Coffee,-4.50\n2026-11-02,Refund,10.00\n");
    expect(f.rows.map((r) => r.amount)).toEqual([-450, 1000]);
  });
});

import { matchBank } from "../src/server/reconcile";
describe("matching bank rows to entries", () => {
  const rows = parseBankCsv(sample).rows;
  const mine = [
    { id: "p", date: "2026-11-10", payee: "Power Co", confirmed: true, seen: -20824 },
    { id: "c", date: "2026-11-07", payee: "Corner Cafe", confirmed: true, seen: -858 },
    { id: "x", date: "2026-11-08", payee: "Target", confirmed: true, seen: -4500 }, // the bank has nothing for this
    { id: "q", date: "2026-11-11", payee: "Netflix", confirmed: false, seen: -964 }, // pending recurring
  ];
  it("matches by amount within four days, lists the rest as new or missing", () => {
    const r = matchBank(rows, mine, [{ name: "Employer Inc", lastCategoryId: null }], "2026-11-06", "2026-11-12");
    expect(r.matched.map((m) => m.id)).toEqual(["p", "c"]);
    expect(r.newRows.map((n) => [n.payee, n.amount, n.transfer])).toEqual([["INTERNET DEBIT TRANSFER CREDIT TO DD ****1111", -1250, true], ["EMPLOYER INC ACH", 295000, false]]);
    expect(r.newRows[1]!.suggestedPayee).toBe("Employer Inc");
    expect(r.missing.map((m) => [m.id, m.pending])).toEqual([["x", false], ["q", true]]);
  });
});
