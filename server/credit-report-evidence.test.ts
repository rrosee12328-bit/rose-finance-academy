import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVerifiedEvidenceToPlan,
  applyVerifiedEvidenceToReport,
  buildCreditReportEvidence,
  extractClientNameFromReport,
} from "./credit-report-evidence";

test("GitHub collection improvements retain verified identity and zero-bankruptcy safeguards", () => {
  for (const evidenceLine of [
    "Account Type Factoring Company Account",
    "Comments Placed for collection",
    "Payment Status Collection",
    "Pay Status In collection",
  ]) {
    const text = `Three Bureau Credit Report
Jamie R Example | August 17, 2026
Public Records 0 0 0
6.1 Example Recovery
Account Number xxxx1234
${evidenceLine}
Included in Bankruptcy 0 0 0
10. Public Records
Bankruptcies
You currently have no Bankruptcies on your credit file.
11. Collections
12. Dispute File Information`;
    const report = applyVerifiedEvidenceToReport({
      extractedText: text, generatedPlan: { negativeAccounts: [] },
    });
    assert.equal(report.generatedPlan.negativeAccounts[0].issueType, "Collection");
    assert.equal(report.generatedPlan.negativeAccounts[0].accountNumberMasked, "****1234");
    assert.equal(report.generatedPlan.counts.publicRecords, 0);
    assert.equal(buildCreditReportEvidence(text.replace("xxxx1234", "Not Reported")).negativeAccounts.length, 0);
  }
});

const shawnikaFixture = `
powered by
Three Bureau Credit Report
Shawnika Toliver
August 16, 2026
Three Bureau Credit Report
Shawnika D Toliver | August 17, 2026
Inquiries 7 4 10
Public Records 0 0 0
2.1 Capital One Bank Usa (CLOSED)
Account Number xxxxxxxx 6772 xxxxxxxx 6772 xxxxxxxx 6772
30 Days Past Due 0 0 0
Collection Account 0 0 0
Charge Off 0 0 0
Included in Bankruptcy 0 0 0
Status Pays as Agreed Pays as Agreed Pays as Agreed
2.2 Tbom/fortiva Mc (CLOSED)
Account Number xxxxxxxxxxxx 6954 xxxxxxxx 8124 xxxxxxxxxxxx 6954
30 Days Past Due 2 2 2
Collection Account 0 0 0
Charge Off 0 0 0
Included in Bankruptcy 0 0 0
2.11 Discover Card
Account Number xxxxxxxx 2921 xxxxxxxx 2921 xxxxxxxx 2921
30 Days Past Due 0 0 2
Included in Bankruptcy 0 0 0
2.12 Cb Indigo
Account Number xxxxxxxxxxxx 4869 xxxxxxxx 7797 xxxxxxxxxxxx 4869
30 Days Past Due 1 1 1
Included in Bankruptcy 0 0 0
2.13 Credit One Bank
Account Number xxxxxxxxxxxx 1292 xxxxxxxx 1292 xxxxxxxxxxxx 1292
60 Days Past Due 1 0 1
Included in Bankruptcy 0 0 0
2.14 Macys/citibank Na
Account Number xxxxxxxxxxxx 3142 xxxxxxxx 3142 xxxxxxxxxxxx 3142
90 Days Past Due 0 1 0
Included in Bankruptcy 0 0 0
4.12 Jpmcb Auto Finance
Account Number xxxxxx 01 xxxxxx 01 xxxxxx 01
Account Status Collection Account Closed Closed
30 Days Past Due 1 1 N/A
Charge Off Amount $1,946 N/A $1,946
Included in Bankruptcy 0 0 N/A
-- 153 of 156 --
10. Public Records
Bankruptcies
You currently have no Bankruptcies on your credit file.
Judgments
You currently have no Judgments on your credit file.
Liens
You currently have no Liens on your credit file.
-- 154 of 156 --
11. Collections
Equifax
Agency Client: JPMCB AUTO FINANCE
TransUnion
Agency Client: JPMCB AUTO
Account Number xxxxxx 01
Account Number xxxxxx 01
12. Dispute File Information
`;

test("extracts the full client name from report text", () => {
  assert.equal(extractClientNameFromReport(shawnikaFixture), "Shawnika D Toliver");
});

test("uses only verified PDF evidence for negative accounts", () => {
  const evidence = buildCreditReportEvidence(shawnikaFixture);

  assert.deepEqual(
    evidence.negativeAccounts,
    [
      {
        accountName: "Tbom/fortiva Mc",
        accountNumberMasked: "****6954",
        issueType: "Late Payment",
        priority: "Medium",
      },
      {
        accountName: "Discover Card",
        accountNumberMasked: "****2921",
        issueType: "Late Payment",
        priority: "Medium",
      },
      {
        accountName: "Cb Indigo",
        accountNumberMasked: "****4869",
        issueType: "Late Payment",
        priority: "Medium",
      },
      {
        accountName: "Credit One Bank",
        accountNumberMasked: "****1292",
        issueType: "Late Payment",
        priority: "Medium",
      },
      {
        accountName: "Macys/citibank Na",
        accountNumberMasked: "****3142",
        issueType: "Late Payment",
        priority: "Medium",
      },
      {
        accountName: "Jpmcb Auto Finance",
        accountNumberMasked: "****01",
        issueType: "Collection / Charge-off / Late Payment",
        priority: "High",
      },
    ],
  );
  assert.equal(evidence.counts.publicRecords, 0);
  assert.equal(evidence.counts.inquiries, 10);
  assert.equal(evidence.hasVerifiedPublicRecords, false);
  assert.ok(!evidence.negativeAccounts.some((account) => /154 of 156|capital one/i.test(account.accountName)));
});

test("replaces old AI rows and removes unsupported bankruptcy actions", () => {
  const oldPlan = {
    clientName: "report",
    diagnosisSummary: "Many bankruptcy records were found.",
    counts: { collections: 0, chargeOffs: 0, latePayments: 0, inquiries: 0, publicRecords: 21 },
    negativeAccounts: [
      {
        accountName: "Capital One Bank Usa",
        accountNumberMasked: "****6772",
        issueType: "Bankruptcy Public Record",
        priority: "High",
      },
      {
        accountName: "154 of 156",
        accountNumberMasked: "****0156",
        issueType: "Bankruptcy Public Record",
        priority: "High",
      },
    ],
    actionPlan: {
      week1: [
        "Dispute the bankruptcy immediately.",
        "Dispute the 154 of 156 ****2026 collection.",
        "Review TBOM/FORTIVA MC ****6954.",
        "Review the verified collection account.",
      ],
      week2: [],
      week3: [],
      week4: [],
    },
  };

  const cleaned = applyVerifiedEvidenceToPlan(oldPlan, shawnikaFixture);
  assert.equal(cleaned.clientName, "Shawnika D Toliver");
  assert.equal(cleaned.counts.publicRecords, 0);
  assert.equal(cleaned.negativeAccounts.length, 6);
  assert.deepEqual(cleaned.actionPlan.week1, [
    "Review TBOM/FORTIVA MC ****6954.",
    "Review the verified collection account.",
  ]);
  assert.match(cleaned.diagnosisSummary, /No verified public records were found/);
});

test("rejects placeholder account-number labels", () => {
  const evidence = buildCreditReportEvidence(`
Three Bureau Credit Report
Jamie R Example | August 17, 2026
Public Records 0 0 0
2.1 Example Creditor
Account Number Not Reported
30 Days Past Due 1 0 0
2.2 Another Example Creditor
Account Number xxxx TEST
60 Days Past Due 0 1 0
10. Public Records
You currently have no Bankruptcies on your credit file.
11. Collections
12. Dispute File Information
`);

  assert.deepEqual(evidence.negativeAccounts, []);
});

test("requires a real court and case number for public records", () => {
  const evidence = buildCreditReportEvidence(`
Three Bureau Credit Report
Jamie R Example | August 17, 2026
Public Records 1 0 0
10. Public Records
Bankruptcy Chapter 7
Court Name: U.S. Bankruptcy Court
Case Number: xx1234
11. Collections
12. Dispute File Information
`);

  assert.deepEqual(evidence.negativeAccounts, [
    {
      accountName: "U.S. Bankruptcy Court",
      accountNumberMasked: "****1234",
      issueType: "Bankruptcy Public Record",
      priority: "High",
    },
  ]);
  assert.equal(evidence.counts.publicRecords, 1);
});

test("keeps a verified judgment when the bankruptcy subsection is empty", () => {
  const evidence = buildCreditReportEvidence(`
Three Bureau Credit Report
Jamie R Example | August 17, 2026
Public Records 0 1 0
10. Public Records
Bankruptcies
You currently have no Bankruptcies on your credit file.
Judgments
Court Name: County Civil Court
Case Number: xx7788
Liens
You currently have no Liens on your credit file.
11. Collections
12. Dispute File Information
`);

  assert.deepEqual(evidence.negativeAccounts, [
    {
      accountName: "County Civil Court",
      accountNumberMasked: "****7788",
      issueType: "Public Record",
      priority: "High",
    },
  ]);
});

test("cleans legacy report responses across every rendered plan field", () => {
  const cleaned = applyVerifiedEvidenceToReport({
    clientName: "report",
    extractedText: shawnikaFixture,
    generatedPlan: {
      clientName: "report",
      counts: { publicRecords: 21 },
      negativeAccounts: [],
      disputeStrategy: {
        challengeBasis: ["Accuracy", "Challenge the Chapter 7 bankruptcy"],
        expectedOutcomes: ["Remove the public record", "Correct verified account data"],
      },
      actionPlan: { week1: ["Dispute the 154 of 156 ****2026 collection."] },
      creditBuilding: {
        recommendations: ["Resolve the tax lien", "Keep card balances low"],
      },
      accountabilityNote: "Your bankruptcy does not define your future.",
    },
  });

  assert.equal(cleaned.clientName, "Shawnika D Toliver");
  assert.deepEqual(cleaned.generatedPlan.disputeStrategy.challengeBasis, ["Accuracy"]);
  assert.deepEqual(cleaned.generatedPlan.disputeStrategy.expectedOutcomes, ["Correct verified account data"]);
  assert.deepEqual(cleaned.generatedPlan.creditBuilding.recommendations, ["Keep card balances low"]);
  assert.equal(cleaned.generatedPlan.accountabilityNote, "");
  assert.deepEqual(cleaned.generatedPlan.actionPlan.week1, []);
});