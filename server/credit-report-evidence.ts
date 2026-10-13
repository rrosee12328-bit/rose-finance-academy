export type VerifiedIssueType =
  | "Charge-off"
  | "Collection"
  | "Late Payment"
  | "Bankruptcy Public Record"
  | "Public Record";

export interface VerifiedNegativeAccount {
  accountName: string;
  accountNumberMasked: string;
  issueType: string;
  priority: "High" | "Medium" | "Low";
}

export interface CreditReportEvidence {
  clientName: string | null;
  negativeAccounts: VerifiedNegativeAccount[];
  counts: {
    latePayments: number;
    collections: number;
    chargeOffs: number;
    inquiries: number;
    publicRecords: number;
  };
  hasVerifiedPublicRecords: boolean;
}

const ACCOUNT_HEADER = /^\d+\.\d+\s+(.+)$/;
const MAJOR_SECTION_HEADER = /^(?:[1-9]|1[0-2])\.\s+/;
const PAGE_ARTIFACT = /^(?:--\s*)?\d+\s+of\s+\d+(?:\s*--)?$/i;
const BUREAU_HEADER = /^(?:equifax|experian|transunion)(?:\s+(?:equifax|experian|transunion))*$/i;
const GENERIC_ACCOUNT_NAME = /^(?:account|account name|account number|collections?|public records?|bankruptcies|judgments|liens|payment summary|account details|report summary|three bureau credit report|credit report|report)$/i;
const MONTH_NAME = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleCaseName(name: string): string {
  if (/[a-z]/.test(name)) return name.replace(/\s+/g, " ").trim();
  return name
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
    .trim();
}

function isValidPersonName(candidate: string): boolean {
  const cleaned = candidate.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  return Boolean(
    words.length >= 2 &&
    words.length <= 5 &&
    cleaned.length <= 80 &&
    /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,4}$/.test(cleaned) &&
    !/credit report|powered by|equifax|experian|transunion|report summary/i.test(cleaned)
  );
}

export function extractClientNameFromReport(text: string): string | null {
  const lines = normalizeLines(text).slice(0, 100);
  const datedNamePattern = new RegExp(
    `^(.+?)\\s*\\|\\s*${MONTH_NAME}\\s+\\d{1,2},\\s+\\d{4}$`,
    "i",
  );

  for (const line of lines) {
    const match = line.match(datedNamePattern);
    if (match && isValidPersonName(match[1])) {
      return titleCaseName(match[1]);
    }
  }

  const dateOnlyPattern = new RegExp(`^${MONTH_NAME}\\s+\\d{1,2},\\s+\\d{4}$`, "i");
  for (let i = 0; i < lines.length - 2; i++) {
    if (!/^(?:three bureau )?credit report$/i.test(lines[i])) continue;
    const possibleName = lines[i + 1];
    if (isValidPersonName(possibleName) && dateOnlyPattern.test(lines[i + 2])) {
      return titleCaseName(possibleName);
    }
  }

  return null;
}

export function maskVerifiedAccountNumber(raw: string): string {
  const compact = raw.replace(/\s+/g, "").replace(/^[#:]+|[#:]+$/g, "");
  if (!compact) return "";

  const maskedSuffix = compact.match(/[xX*#•-]{2,}([A-Za-z0-9]{2,})$/);
  if (maskedSuffix) {
    const suffix = maskedSuffix[1];
    return `****${suffix.slice(-4)}`;
  }

  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 2) {
    return `****${digits.slice(-4)}`;
  }

  const alphanumeric = compact.replace(/[^A-Za-z0-9]/g, "");
  return alphanumeric.length >= 2 ? `****${alphanumeric.slice(-4)}` : "";
}

function chooseMostReliableSuffix(candidates: string[]): string {
  const normalized = candidates
    .map((candidate) => candidate.replace(/[^A-Za-z0-9]/g, ""))
    .filter((candidate) => candidate.length >= 2);
  if (normalized.length === 0) return "";

  const counts = new Map<string, number>();
  for (const candidate of normalized) {
    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  }

  return normalized.reduce((best, candidate) => {
    const bestCount = counts.get(best) || 0;
    const candidateCount = counts.get(candidate) || 0;
    return candidateCount > bestCount ? candidate : best;
  }, normalized[0]);
}

function isValidIdentifierCandidate(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  return (
    digits.length >= 2 &&
    !/^(?:n\/?a|unknown|notreported|notavailable|none|pending)$/i.test(
      candidate.replace(/[^A-Za-z]/g, ""),
    )
  );
}

function extractLabeledAccountNumber(blockLines: string[], labels = ["account number", "case number", "docket number"]): string {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const labelPattern = new RegExp(`^(?:${escapedLabels.join("|")})\\s*(?::|#|-)?\\s*(.+)$`, "i");

  for (const line of blockLines) {
    const match = line.match(labelPattern);
    if (!match) continue;

    const value = match[1];
    const maskedCandidates = Array.from(
      value.matchAll(/[xX*#•-]{2,}\s*([A-Za-z0-9]{2,})/g),
      (candidate) => candidate[1],
    ).filter(isValidIdentifierCandidate);
    const suffix = chooseMostReliableSuffix(maskedCandidates);
    if (suffix) return `****${suffix.slice(-4)}`;

    const standaloneCandidates = value.match(/\b[A-Za-z0-9][A-Za-z0-9-]{1,}\b/g) || [];
    const standalone = chooseMostReliableSuffix(
      standaloneCandidates.filter(isValidIdentifierCandidate),
    );
    if (standalone) return maskVerifiedAccountNumber(standalone);
  }

  return "";
}

function hasPositiveCount(line: string, label: RegExp): boolean {
  const match = line.match(label);
  if (!match) return false;
  const values = match[1].match(/\b\d+\b/g) || [];
  return values.some((value) => Number(value) > 0);
}

function hasPositiveMoney(line: string): boolean {
  const values = line.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
  return values.some((value) => Number(value.replace(/[$,]/g, "")) > 0);
}

function collectTradelineIssues(blockLines: string[]): Set<VerifiedIssueType> {
  const issues = new Set<VerifiedIssueType>();

  for (const line of blockLines) {
    if (/\b(?:factoring\s*company\s*account|collection\s*agency|placed\s+for\s+collection|in\s+collection)\b/i.test(line) ||
        /^(?:account\s+status|payment\s+status|pay\s+status|status|comments?)\b.*\bcollection\b/i.test(line)) {
      if (!/\b(?:no|not|never)\b/i.test(line)) issues.add("Collection");
    }
    if (/^past\s+due\s+amount\b/i.test(line) && hasPositiveMoney(line)) issues.add("Late Payment");
    if (hasPositiveCount(line, /^(?:30|60|90|120)\s+days?\s+past\s+due\s+(.+)$/i)) {
      issues.add("Late Payment");
      continue;
    }
    if (hasPositiveCount(line, /^collection\s+account\s+(.+)$/i)) {
      issues.add("Collection");
      continue;
    }
    if (hasPositiveCount(line, /^charge\s*off\s+(.+)$/i)) {
      issues.add("Charge-off");
      continue;
    }
    if (/^charge\s*off\s+amount\b/i.test(line) && hasPositiveMoney(line)) {
      issues.add("Charge-off");
      continue;
    }
    if (/^(?:account\s+status|status)\b.*\bcollection\s+account\b/i.test(line)) {
      issues.add("Collection");
      continue;
    }
    if (/^(?:account\s+status|payment\s+status|pay\s+status|status)\b.*\b(?:charge[d]?[\s-]*off|profit and loss)\b/i.test(line)) {
      issues.add("Charge-off");
      continue;
    }
    if (/\b(?:charged off account|account charged to profit and loss|unpaid balance reported as a loss)\b/i.test(line)) {
      issues.add("Charge-off");
      continue;
    }
    if (/\b(?:last reported delinquencies|was \d+\s+days?\s+past due|delinquent \d+\s+days?\s+past due)\b/i.test(line)) {
      issues.add("Late Payment");
    }
  }

  return issues;
}

function isJunkAccountName(name: string): boolean {
  const cleaned = name.replace(/\s+/g, " ").trim();
  return Boolean(
    !cleaned ||
    cleaned.length > 100 ||
    !/[A-Za-z]/.test(cleaned) ||
    PAGE_ARTIFACT.test(cleaned) ||
    BUREAU_HEADER.test(cleaned) ||
    GENERIC_ACCOUNT_NAME.test(cleaned) ||
    /^page\s+\d+\s+of\s+\d+$/i.test(cleaned) ||
    /powered by|payment summary|account details|report summary/i.test(cleaned)
  );
}

function cleanTradelineName(rawName: string): string {
  return rawName
    .replace(/\s*\(CLOSED\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function issueLabel(issues: Set<VerifiedIssueType>): string {
  const order: VerifiedIssueType[] = [
    "Collection",
    "Charge-off",
    "Late Payment",
    "Bankruptcy Public Record",
    "Public Record",
  ];
  return order.filter((issue) => issues.has(issue)).join(" / ");
}

function priorityForIssues(issues: Set<VerifiedIssueType>): "High" | "Medium" | "Low" {
  return issues.has("Collection") ||
    issues.has("Charge-off") ||
    issues.has("Bankruptcy Public Record") ||
    issues.has("Public Record")
    ? "High"
    : "Medium";
}

function extractTradelineAccounts(lines: string[]): VerifiedNegativeAccount[] {
  const accounts: VerifiedNegativeAccount[] = [];

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(ACCOUNT_HEADER);
    if (!headerMatch) continue;

    const blockLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (ACCOUNT_HEADER.test(lines[j]) || MAJOR_SECTION_HEADER.test(lines[j])) break;
      blockLines.push(lines[j]);
    }

    const accountName = cleanTradelineName(headerMatch[1]);
    const accountNumberMasked = extractLabeledAccountNumber(blockLines);
    const issues = collectTradelineIssues(blockLines);
    if (
      isJunkAccountName(accountName) ||
      !accountNumberMasked ||
      issues.size === 0
    ) {
      continue;
    }

    accounts.push({
      accountName,
      accountNumberMasked,
      issueType: issueLabel(issues),
      priority: priorityForIssues(issues),
    });
  }

  return accounts;
}

function findSection(lines: string[], startPattern: RegExp, endPattern: RegExp): string[] {
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start === -1) return [];
  const endOffset = lines.slice(start + 1).findIndex((line) => endPattern.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end);
}

function normalizeCollectionName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    jpmcbauto: "Jpmcb Auto Finance",
    jpmcbautofinance: "Jpmcb Auto Finance",
  };
  const key = normalizeNameKey(cleaned);
  if (aliases[key]) return aliases[key];
  return titleCaseName(cleaned);
}

function extractCollectionAccounts(lines: string[]): VerifiedNegativeAccount[] {
  const section = findSection(lines, /^11\.\s+Collections$/i, /^12\.\s+/i);
  if (section.length === 0) return [];

  const agencies = section
    .map((line) => line.match(/^(?:Agency Client|Agency|Collector|Creditor):\s*(.+)$/i)?.[1])
    .filter((name): name is string => Boolean(name))
    .map(normalizeCollectionName)
    .filter((name) => !isJunkAccountName(name));
  const accountNumbers = section
    .filter((line) => /^Account Number\b/i.test(line))
    .map((line) => extractLabeledAccountNumber([line]))
    .filter(Boolean);

  const accounts: VerifiedNegativeAccount[] = [];
  for (let i = 0; i < Math.min(agencies.length, accountNumbers.length); i++) {
    accounts.push({
      accountName: agencies[i],
      accountNumberMasked: accountNumbers[i],
      issueType: "Collection",
      priority: "High",
    });
  }
  return accounts;
}

function parseSummaryValues(lines: string[], label: string): number[] | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedLabel}\\s+((?:(?:N\\/A|\\d+)\\s*)+)$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    return (match[1].match(/\d+/g) || []).map(Number);
  }
  return null;
}

function extractPublicRecordAccounts(lines: string[]): VerifiedNegativeAccount[] {
  const summary = parseSummaryValues(lines, "Public Records");
  if (summary && summary.length > 0 && summary.every((value) => value === 0)) {
    return [];
  }

  const section = findSection(lines, /^10\.\s+Public Records$/i, /^11\.\s+/i);
  if (section.length === 0) return [];

  const records: VerifiedNegativeAccount[] = [];
  let subsection: "bankruptcy" | "judgment" | "lien" | "other" = "other";
  let subsectionExplicitlyEmpty = false;

  for (let i = 0; i < section.length; i++) {
    if (/^Bankrupt(?:cy|cies)(?:\s+Chapter\s*(?:7|11|13))?$/i.test(section[i])) {
      subsection = "bankruptcy";
      subsectionExplicitlyEmpty = false;
      continue;
    }
    if (/^Judgments$/i.test(section[i])) {
      subsection = "judgment";
      subsectionExplicitlyEmpty = false;
      continue;
    }
    if (/^Liens$/i.test(section[i])) {
      subsection = "lien";
      subsectionExplicitlyEmpty = false;
      continue;
    }
    if (/^You currently have no (?:Bankruptcies|Judgments|Liens) on your credit file\.$/i.test(section[i])) {
      subsectionExplicitlyEmpty = true;
      continue;
    }
    if (!/^(?:case|docket)\s*(?:number|#)\b/i.test(section[i])) continue;
    if (subsectionExplicitlyEmpty) continue;

    const window = section.slice(Math.max(0, i - 8), Math.min(section.length, i + 9));
    const accountNumberMasked = extractLabeledAccountNumber([section[i]], ["case number", "docket number"]);
    const courtLine = window.find((line) => /^(?:court|court name|filing court)\s*(?::|-)\s*\S+/i.test(line));
    const accountName = courtLine
      ? courtLine.replace(/^(?:court|court name|filing court)\s*(?::|-)\s*/i, "").trim()
      : "";
    if (!accountNumberMasked || isJunkAccountName(accountName)) continue;

    const issueType: VerifiedIssueType = subsection === "bankruptcy"
      ? "Bankruptcy Public Record"
      : "Public Record";
    records.push({
      accountName,
      accountNumberMasked,
      issueType,
      priority: "High",
    });
  }

  return records;
}

function namesAreCompatible(left: string, right: string): boolean {
  const leftKey = normalizeNameKey(left);
  const rightKey = normalizeNameKey(right);
  if (leftKey === rightKey) return true;
  const shorter = leftKey.length <= rightKey.length ? leftKey : rightKey;
  const longer = leftKey.length > rightKey.length ? leftKey : rightKey;
  return shorter.length >= 6 && longer.startsWith(shorter);
}

function mergeVerifiedAccounts(accounts: VerifiedNegativeAccount[]): VerifiedNegativeAccount[] {
  const merged: Array<VerifiedNegativeAccount & { issues: Set<VerifiedIssueType> }> = [];

  for (const account of accounts) {
    if (
      isJunkAccountName(account.accountName) ||
      !/^\*{4}[A-Za-z0-9]{2,4}$/.test(account.accountNumberMasked)
    ) {
      continue;
    }

    const issues = new Set(
      account.issueType
        .split("/")
        .map((issue) => issue.trim())
        .filter((issue): issue is VerifiedIssueType =>
          ["Charge-off", "Collection", "Late Payment", "Bankruptcy Public Record", "Public Record"].includes(issue),
        ),
    );
    const existing = merged.find(
      (candidate) =>
        candidate.accountNumberMasked === account.accountNumberMasked &&
        namesAreCompatible(candidate.accountName, account.accountName),
    );

    if (!existing) {
      merged.push({ ...account, issues });
      continue;
    }

    if (account.accountName.length > existing.accountName.length) {
      existing.accountName = account.accountName;
    }
    issues.forEach((issue) => existing.issues.add(issue));
    existing.issueType = issueLabel(existing.issues);
    existing.priority = priorityForIssues(existing.issues);
  }

  return merged.map(({ issues: _issues, ...account }) => account);
}

function countIssue(accounts: VerifiedNegativeAccount[], pattern: RegExp): number {
  return accounts.filter((account) => pattern.test(account.issueType)).length;
}

export function buildCreditReportEvidence(text: string): CreditReportEvidence {
  const lines = normalizeLines(text);
  const negativeAccounts = mergeVerifiedAccounts([
    ...extractTradelineAccounts(lines),
    ...extractCollectionAccounts(lines),
    ...extractPublicRecordAccounts(lines),
  ]);
  const inquirySummary = parseSummaryValues(lines, "Inquiries");

  return {
    clientName: extractClientNameFromReport(text),
    negativeAccounts,
    counts: {
      latePayments: countIssue(negativeAccounts, /late payment/i),
      collections: countIssue(negativeAccounts, /collection/i),
      chargeOffs: countIssue(negativeAccounts, /charge-off/i),
      inquiries: inquirySummary && inquirySummary.length > 0 ? Math.max(...inquirySummary) : 0,
      publicRecords: countIssue(negativeAccounts, /public record|bankruptcy/i),
    },
    hasVerifiedPublicRecords: negativeAccounts.some((account) => /public record|bankruptcy/i.test(account.issueType)),
  };
}

function verifiedDiagnosis(evidence: CreditReportEvidence): string {
  const { collections, chargeOffs, latePayments, publicRecords } = evidence.counts;
  const publicRecordText = publicRecords === 0
    ? "No verified public records were found."
    : `${publicRecords} verified public record${publicRecords === 1 ? "" : "s"} were found.`;
  return `The report contains ${collections} collection account${collections === 1 ? "" : "s"}, ${chargeOffs} charge-off${chargeOffs === 1 ? "" : "s"}, and ${latePayments} account${latePayments === 1 ? "" : "s"} with late payments. ${publicRecordText}`;
}

const UNSUPPORTED_PUBLIC_RECORD_LANGUAGE = /bankrupt|chapter\s*(?:7|11|13)|public record|court record|judgment|tax lien|\bliens?\b/i;

function removeUnsupportedPublicRecordContent(value: any): any {
  if (typeof value === "string") {
    return UNSUPPORTED_PUBLIC_RECORD_LANGUAGE.test(value) ? "" : value;
  }
  if (Array.isArray(value)) {
    return value
      .map(removeUnsupportedPublicRecordContent)
      .filter((item) => item !== "" && item !== null && item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, removeUnsupportedPublicRecordContent(child)]),
    );
  }
  return value;
}

function cleanActionPlan(actionPlan: any, evidence: CreditReportEvidence): any {
  if (!actionPlan || typeof actionPlan !== "object") return actionPlan;
  const verifiedAccountNumbers = new Set(
    evidence.negativeAccounts.map((account) => account.accountNumberMasked.toLowerCase()),
  );
  const cleaned: Record<string, unknown> = {};
  for (const [week, actions] of Object.entries(actionPlan)) {
    cleaned[week] = Array.isArray(actions)
      ? actions.filter((action) => {
          const text = String(action);
          if (/\b\d+\s+of\s+\d+\b/i.test(text)) return false;
          if (
            !evidence.hasVerifiedPublicRecords &&
            UNSUPPORTED_PUBLIC_RECORD_LANGUAGE.test(text)
          ) {
            return false;
          }

          const referencedAccountNumbers = text.match(/\*{4}[A-Za-z0-9]{2,4}\b/g) || [];
          return referencedAccountNumbers.every((accountNumber) =>
            verifiedAccountNumbers.has(accountNumber.toLowerCase()),
          );
        })
      : actions;
  }
  return cleaned;
}

export function applyVerifiedEvidenceToPlan(plan: any, extractedText: string): any {
  if (!plan || typeof plan !== "object") return plan;
  const evidence = buildCreditReportEvidence(extractedText);
  const cleanedPlan = {
    ...plan,
    clientName: evidence.clientName || plan.clientName,
    diagnosisSummary: verifiedDiagnosis(evidence),
    counts: {
      ...(plan.counts || {}),
      ...evidence.counts,
    },
    negativeAccounts: evidence.negativeAccounts,
  };

  cleanedPlan.actionPlan = cleanActionPlan(plan.actionPlan, evidence);
  if (!evidence.hasVerifiedPublicRecords) {
    cleanedPlan.disputeStrategy = removeUnsupportedPublicRecordContent(plan.disputeStrategy);
    cleanedPlan.creditBuilding = removeUnsupportedPublicRecordContent(plan.creditBuilding);
    cleanedPlan.accountabilityNote = removeUnsupportedPublicRecordContent(plan.accountabilityNote);
  }

  return cleanedPlan;
}

export function applyVerifiedEvidenceToReport(report: any): any {
  if (!report?.generatedPlan || !report?.extractedText) return report;
  const generatedPlan = applyVerifiedEvidenceToPlan(report.generatedPlan, report.extractedText);
  return {
    ...report,
    clientName: generatedPlan.clientName || report.clientName,
    generatedPlan,
  };
}