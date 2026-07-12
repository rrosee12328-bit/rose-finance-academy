import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import { openai } from "./replit_integrations/audio/client";
import { PDFParse } from "pdf-parse";
import PDFDocument from "pdfkit";

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// PDF Debug Info Type
interface PDFDebugInfo {
  filename: string;
  fileSize: number;
  mimeType: string;
  headerOk: boolean;
  parsersUsed: string[];
  errors: string[];
  charCount: number;
  pagesRead?: number;
  creditDataFound?: {
    scores: string[];
    collections: number;
    chargeOffs: number;
    latePayments: number;
    inquiries: number;
    publicRecords: number;
  };
}

// Helper: Preprocess text
function preprocessText(text: string): string {
  // Normalize line breaks and whitespace
  let cleaned = text.replace(/\r\n/g, "\n");
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\n\n+/g, "\n");
  cleaned = cleaned.replace(/  +/g, " ");
  return cleaned.trim();
}

// Helper: Extract credit report data using pattern matching
function extractCreditData(text: string): any {
  const lowerText = text.toLowerCase();

  const patterns = {
    scores: /(?:fico|credit score|score)[\s:]*(\d{2,3})/gi,
    collections: /collection|collection account|placed for collection/gi,
    chargeOffs: /charge[- ]?off|charged off|chargeoff/gi,
    latePayments: /late\s+(?:\d+|payment)|late \d+ days/gi,
    hardInquiries: /(?:hard\s+)?inquiry|inquiries/gi,
    publicRecords: /bankruptcy|chapter\s*7|chapter\s*13|u\.?s\.?\s*bankruptcy\s*court|public\s*record|court\s*record|bk7|bk13|tax\s*lien|civil\s*judgment/gi,
    derogatory: /derogatory|included in bankruptcy|account rating:\s*derogatory/gi,
  };

  const found = {
    scores: [] as string[],
    collections: 0,
    chargeOffs: 0,
    latePayments: 0,
    inquiries: 0,
    publicRecords: 0,
    derogatory: 0,
    hasBankruptcy: false,
    bankruptcyChapter: "" as string,
  };

  let scoreMatch: RegExpExecArray | null;
  while ((scoreMatch = patterns.scores.exec(text)) !== null) {
    const match = scoreMatch;
    found.scores.push(match[1]);
  }
  found.scores = Array.from(new Set(found.scores));

  found.collections = text.match(patterns.collections)?.length || 0;
  found.chargeOffs = text.match(patterns.chargeOffs)?.length || 0;
  found.latePayments = text.match(patterns.latePayments)?.length || 0;
  found.inquiries = text.match(patterns.hardInquiries)?.length || 0;
  found.publicRecords = text.match(patterns.publicRecords)?.length || 0;
  found.derogatory = text.match(patterns.derogatory)?.length || 0;

  if (/chapter\s*7|bk7/i.test(text)) {
    found.hasBankruptcy = true;
    found.bankruptcyChapter = "Chapter 7";
  } else if (/chapter\s*13|bk13/i.test(text)) {
    found.hasBankruptcy = true;
    found.bankruptcyChapter = "Chapter 13";
  } else if (/bankruptcy/i.test(text)) {
    found.hasBankruptcy = true;
    found.bankruptcyChapter = "Bankruptcy";
  }

  return found;
}

// --- Collection Block Extraction ---
interface CollectionBlock {
  companyName: string;
  accountNumber: string;
  rawBlock: string;
  lineIndex: number;
  fallbackReason?: string;
}

const BUREAU_HEADERS = /^(transunion|experian|equifax|tu|ex|eq)$/i;
const GENERIC_LABELS = /^(collection account|account name|account number|acct(?:ount)?\s*(?:#|no\.?|number)?|status|type|date|balance|payment|remarks|comments|account type|responsibility|condition|pay status|account status|creditor|creditor name|company|company name|collector|collector name|collection agency|original creditor|credit limit|high balance|terms|date opened|date reported|date of status|last reported)$/i;
const GENERIC_WORDS = /^(collection|account|status|type|date|the|and|for|with|from|this|that|not|are|was|were|has|have|had|been|will|would|could|should|may|might|shall|can|did|does|do|is|am|be)$/i;
const PLACEHOLDER_ACCOUNT_NAMES = /^(unknown|unknown collection|n\/a|na|not available|not provided|not listed|none)$/i;

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPlaceholderAccountName(name: string): boolean {
  return PLACEHOLDER_ACCOUNT_NAMES.test(name.trim());
}

function sanitizeCompanyCandidate(candidate: string): string {
  return candidate
    .replace(/^(?:account|creditor|company|collector|collection agency|original creditor)\s*(?:name)?\s*[:#\-–|]\s*/i, '')
    .replace(/\b(?:collection account|placed for collection|in collection|account number|acct(?:ount)?\s*(?:#|no\.?|number)?|status|balance)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function maskAccountNumber(raw: string): string {
  const cleaned = raw.replace(/\s+/g, '').replace(/^[#:]+|[#:]+$/g, '');
  const digits = cleaned.replace(/\D/g, '');

  if (digits.length >= 4) {
    return `****${digits.slice(-4)}`;
  }

  const alnum = cleaned.replace(/[^A-Za-z0-9]/g, '');
  if (alnum.length >= 4) {
    return `****${alnum.slice(-4)}`;
  }

  return cleaned;
}

function hasUsableAccountNumber(accountNumber: string): boolean {
  const normalized = maskAccountNumber(accountNumber);
  return Boolean(
    normalized &&
    normalized !== 'N/A' &&
    /[\d*#•]/.test(normalized) &&
    normalized.replace(/\D/g, '').length >= 4
  );
}

function extractAccountNumberFromText(rawBlock: string): string {
  const lines = rawBlock.split('\n').map(line => line.trim()).filter(Boolean);
  const labeledAccountPattern = /(?:account\s*(?:number|#|num|no\.?)|acct\s*(?:#|num|no\.?|number)?|case\s*(?:number|#))\s*[:#\-–]?\s*([#*Xx•-]*\d[#*Xx•\-\d ]{3,31})/i;

  for (const line of lines) {
    if (/account\s+name/i.test(line)) continue;
    const labeledMatch = line.match(labeledAccountPattern);
    if (labeledMatch) {
      const masked = maskAccountNumber(labeledMatch[1]);
      if (hasUsableAccountNumber(masked)) return masked;
    }
  }

  const fallbackPattern = /\b(?:[#*xX•-]*\d[#*xX•\-\dA-Z]{3,}|\d{4,})\b/g;
  let fallbackMatch: RegExpExecArray | null;
  while ((fallbackMatch = fallbackPattern.exec(rawBlock)) !== null) {
    const match = fallbackMatch;
    const raw = match[0];
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(raw)) continue;
    if (/^\d{3}[- ]?\d{3}[- ]?\d{4}$/.test(raw)) continue;
    const masked = maskAccountNumber(raw);
    if (hasUsableAccountNumber(masked)) return masked;
  }

  return '';
}

function scoreCompanyName(candidate: string): number {
  const trimmed = sanitizeCompanyCandidate(candidate);
  if (!trimmed || trimmed.length < 2) return -1;
  if (trimmed.length > 80) return -1;
  if (BUREAU_HEADERS.test(trimmed)) return -1;
  if (GENERIC_LABELS.test(trimmed)) return -1;
  if (isPlaceholderAccountName(trimmed)) return -1;

  const words = trimmed.split(/\s+/);
  if (words.length === 1 && GENERIC_WORDS.test(words[0])) return -1;

  let score = 0;

  if (/^\$[\d,.]+$/.test(trimmed)) return -1;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return -1;
  if (/^\d+$/.test(trimmed)) return -1;

  const knownCollectors = /portfolio recovery|midland credit|lvnv funding|convergent|cci|enhanced recovery|ic system|credence|radius global|national credit|allied interstate|ecs financial|progressive|credit corp|receivables|asset acceptance|cavalry|cach|first premier|jefferson capital|encore capital|unifin|transworld|credit collection|collection bureau|agency|associates|financial|services|solutions|capital|funding|recovery|management/i;
  if (knownCollectors.test(trimmed)) score += 30;

  const isUpperCase = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  if (isUpperCase) score += 10;

  const isTitleCase = /^[A-Z][a-z]/.test(trimmed);
  if (isTitleCase) score += 5;

  if (/[A-Za-z]/.test(trimmed)) score += 5;
  if (words.length >= 2 && words.length <= 6) score += 5;
  if (/\b(inc|llc|ltd|corp|co|lp|group)\b/i.test(trimmed)) score += 15;

  if (/collection|placed for collection|in collection/i.test(trimmed) && words.length <= 3) score -= 10;

  return score;
}

function extractCollectionBlocks(text: string): CollectionBlock[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const blocks: CollectionBlock[] = [];
  const usedLineRanges: Set<number> = new Set();

  const collectionPattern = /collection|placed for collection|in collection|collection account/i;

  for (let i = 0; i < lines.length; i++) {
    if (!collectionPattern.test(lines[i])) continue;
    if (usedLineRanges.has(i)) continue;

    const windowStart = Math.max(0, i - 2);
    const windowEnd = Math.min(lines.length - 1, i + 3);

    const windowLines: string[] = [];
    for (let j = windowStart; j <= windowEnd; j++) {
      windowLines.push(lines[j]);
      usedLineRanges.add(j);
    }
    const rawBlock = windowLines.join('\n');

    const accountNumber = extractAccountNumberFromText(rawBlock);

    const candidates: { name: string; score: number; source: string }[] = [];

    const triggerLine = lines[i];
    const beforeColon = sanitizeCompanyCandidate(triggerLine.split(/[:\-–]/)[0].trim());
    if (beforeColon && !collectionPattern.test(beforeColon)) {
      const s = scoreCompanyName(beforeColon);
      if (s > 0) candidates.push({ name: beforeColon, score: s + 3, source: 'trigger-before-colon' });
    }

    for (let j = windowStart; j <= windowEnd; j++) {
      const line = lines[j];

      const labeledNameMatch = line.match(/(?:account|creditor|company|collector|collection agency|original creditor)\s*(?:name)?\s*[:\-–|]\s*(.+)$/i);
      if (labeledNameMatch) {
        const labeledName = sanitizeCompanyCandidate(labeledNameMatch[1]);
        const s = scoreCompanyName(labeledName);
        if (s > 0) {
          candidates.push({
            name: labeledName,
            score: s + 25,
            source: `line-${j}(labeled-name)`
          });
        }
      }

      if (j === i) continue;

      const lineParts = line.split(/[:\-–|]/).map(p => p.trim()).filter(p => p.length > 1);
      for (const part of lineParts) {
        const sanitizedPart = sanitizeCompanyCandidate(part);
        const s = scoreCompanyName(sanitizedPart);
        if (s > 0) {
          const proximity = Math.abs(j - i);
          const proximityBonus = proximity <= 1 ? 10 : proximity <= 2 ? 5 : 0;
          const aboveBonus = j < i ? 5 : 0;
          candidates.push({
            name: sanitizedPart,
            score: s + proximityBonus + aboveBonus,
            source: `line-${j}(${j < i ? 'above' : 'below'})`
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    let companyName = '';
    let fallbackReason: string | undefined;

    if (candidates.length > 0 && candidates[0].score >= 5) {
      companyName = candidates[0].name;
    } else {
      companyName = `Unknown Collection`;
      fallbackReason = candidates.length === 0
        ? 'No candidate names found in window'
        : `Best candidate "${candidates[0]?.name}" scored too low (${candidates[0]?.score})`;
    }

    const normName = normalizeNameKey(companyName);
    const isDuplicate = blocks.some(b => {
      if (hasUsableAccountNumber(accountNumber) && hasUsableAccountNumber(b.accountNumber) && b.accountNumber === accountNumber) return true;
      const existingNorm = normalizeNameKey(b.companyName);
      return existingNorm === normName && normName !== 'unknowncollection';
    });
    if (!isDuplicate) {
      blocks.push({
        companyName,
        accountNumber,
        rawBlock,
        lineIndex: i,
        fallbackReason,
      });
    }
  }

  console.log(`[Collections] Extracted ${blocks.length} collection blocks:`);
  for (const block of blocks) {
    console.log(`  - "${block.companyName}" | Acct: ${block.accountNumber || 'N/A'} | Line: ${block.lineIndex}${block.fallbackReason ? ` | FALLBACK: ${block.fallbackReason}` : ''}`);
  }

  return blocks;
}

// --- Post-AI Negative Account Validation ---
const VALID_ISSUE_TYPES = /(collection|charge[\s-]?off|bankruptcy|public record|late|past due|delinquen|inquir|derogatory|repossession|foreclosure|judgment|tax lien|settled|default|no[\s-]?pay)/i;

const JUNK_PHRASES = [
  /reported\s+(yes|no)/i,
  /classification/i,
  /account status/i,
  /payment status/i,
  /\bsummary\b/i,
  /\bbalances?\b.*\b(too high|utilization)\b/i,
  /creditor classification/i,
  /payment history/i,
  /debt[- ]to[- ]credit/i,
  /credit score/i,
  /credit limit/i,
  /\btip[s]?\b/i,
  /page \d+ of \d+/i,
  /powered by/i,
  /three bureau/i,
  /credit report/i,
  /consumer statement/i,
  /personal note/i,
  /\byour\b.*\b(score|credit|ratio|history)\b/i,
  /\bthe\b.*\b(table|section|chart|idea)\b/i,
];

function computeAccountConfidence(account: any): number {
  let confidence = 0;

  const name = sanitizeCompanyCandidate(account.accountName || '');
  const acctNum = maskAccountNumber(account.accountNumberMasked || '');
  const issueType = (account.issueType || '').trim();

  if (name.length >= 2 && /[A-Za-z]/.test(name)) {
    if (!BUREAU_HEADERS.test(name) && !GENERIC_LABELS.test(name) && !isPlaceholderAccountName(name)) {
      confidence += 40;
    }
  }

  if (acctNum.length >= 2 && acctNum.toLowerCase() !== 'n/a' && /[\dxX*#•]/.test(acctNum)) {
    confidence += 30;
  }

  if (VALID_ISSUE_TYPES.test(issueType)) {
    confidence += 30;
  }

  const nameWords = name.split(/\s+/);
  if (nameWords.length > 8) confidence -= 20;

  const uniqueWords = new Set(nameWords.map(w => w.toLowerCase()));
  if (nameWords.length >= 3 && uniqueWords.size <= Math.ceil(nameWords.length / 2)) {
    confidence -= 40;
  }

  for (const pattern of JUNK_PHRASES) {
    if (pattern.test(name)) {
      confidence -= 50;
      break;
    }
  }

  if (/[.!?]$/.test(name) && nameWords.length > 4) {
    confidence -= 30;
  }

  if (scoreCompanyName(name) < 0) {
    confidence -= 20;
  }

  return Math.max(0, Math.min(100, confidence));
}

function normalizeNegativeAccount(account: any): any {
  return {
    ...account,
    accountName: sanitizeCompanyCandidate(account.accountName || ''),
    accountNumberMasked: maskAccountNumber(account.accountNumberMasked || '') || 'N/A',
    issueType: (account.issueType || '').trim(),
    priority: account.priority || 'Medium',
  };
}

function filterNegativeAccounts(accounts: any[]): any[] {
  if (!Array.isArray(accounts)) return [];

  const validated: any[] = [];

  for (const account of accounts) {
    const normalizedAccount = normalizeNegativeAccount(account);
    const confidence = computeAccountConfidence(normalizedAccount);
    const name = normalizedAccount.accountName;

    if (confidence >= 70) {
      validated.push(normalizedAccount);
      console.log(`[Filter] KEPT (${confidence}%): "${name}" | ${normalizedAccount.issueType} | ${normalizedAccount.accountNumberMasked}`);
    } else {
      console.log(`[Filter] REJECTED (${confidence}%): "${name}" | ${normalizedAccount.issueType} | ${normalizedAccount.accountNumberMasked}`);
    }
  }

  return validated;
}

function getTrustedCollectionBlocks(blocks: CollectionBlock[]): CollectionBlock[] {
  return blocks.filter(block => {
    const name = sanitizeCompanyCandidate(block.companyName);
    return Boolean(name && !isPlaceholderAccountName(name) && scoreCompanyName(name) > 0);
  });
}

function mergePreExtractedCollectionAccounts(accounts: any[], blocks: CollectionBlock[]): any[] {
  const merged = Array.isArray(accounts) ? accounts.map(normalizeNegativeAccount) : [];
  const trustedBlocks = getTrustedCollectionBlocks(blocks);

  for (const block of trustedBlocks) {
    const blockName = sanitizeCompanyCandidate(block.companyName);
    const blockNameKey = normalizeNameKey(blockName);
    const blockAccountNumber = maskAccountNumber(block.accountNumber);

    const existing = merged.find(account => {
      const existingNameKey = normalizeNameKey(account.accountName || '');
      const existingNumber = maskAccountNumber(account.accountNumberMasked || '');

      if (
        hasUsableAccountNumber(blockAccountNumber) &&
        hasUsableAccountNumber(existingNumber) &&
        existingNumber === blockAccountNumber &&
        (!existingNameKey || existingNameKey === blockNameKey)
      ) return true;
      return existingNameKey === blockNameKey;
    });

    if (existing) {
      if (isPlaceholderAccountName(existing.accountName || '') || !existing.accountName) {
        existing.accountName = blockName;
      }
      if (blockAccountNumber && (!existing.accountNumberMasked || existing.accountNumberMasked === 'N/A')) {
        existing.accountNumberMasked = blockAccountNumber;
      }
      if (!existing.issueType || !VALID_ISSUE_TYPES.test(existing.issueType)) {
        existing.issueType = 'Collection';
      }
      if (!existing.priority) {
        existing.priority = 'High';
      }
      continue;
    }

    merged.push({
      accountName: blockName,
      accountNumberMasked: blockAccountNumber || 'N/A',
      issueType: 'Collection',
      priority: 'High',
    });
  }

  const deduped: any[] = [];
  for (const account of merged) {
    const nameKey = normalizeNameKey(account.accountName || '');
    const numberKey = maskAccountNumber(account.accountNumberMasked || '');
    const isDuplicate = deduped.some(existing => {
      const existingNumber = maskAccountNumber(existing.accountNumberMasked || '');
      if (
        hasUsableAccountNumber(numberKey) &&
        hasUsableAccountNumber(existingNumber) &&
        existingNumber === numberKey &&
        normalizeNameKey(existing.accountName || '') === nameKey
      ) return true;
      return normalizeNameKey(existing.accountName || '') === nameKey && nameKey.length > 0;
    });

    if (!isDuplicate) {
      deduped.push(account);
    }
  }

  return deduped;
}

function updateNegativeAccountCounts(plan: any): void {
  const negativeAccounts = Array.isArray(plan.negativeAccounts) ? plan.negativeAccounts : [];

  plan.counts = {
    ...plan.counts,
    collections: negativeAccounts.filter((a: any) => /collection/i.test(a.issueType)).length,
    chargeOffs: negativeAccounts.filter((a: any) => /charge[- ]?off/i.test(a.issueType)).length,
    latePayments: negativeAccounts.filter((a: any) => /late payment|past due|delinquen/i.test(a.issueType)).length,
    publicRecords: negativeAccounts.filter((a: any) => /public record|bankruptcy|judgment|tax lien/i.test(a.issueType)).length,
    inquiries: negativeAccounts.filter((a: any) => /inquiry/i.test(a.issueType)).length,
  };
}

// Enhanced PDF parser with fallback and pattern matching
async function parsePdfFile(
  pdfBuffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<{ ok: boolean; text: string; debug: PDFDebugInfo; error?: string }> {
  const debug: PDFDebugInfo = {
    filename,
    fileSize: pdfBuffer.length,
    mimeType: mimeType || "unknown",
    headerOk: false,
    parsersUsed: [],
    errors: [],
    charCount: 0,
    pagesRead: 0,
    creditDataFound: {
      scores: [],
      collections: 0,
      chargeOffs: 0,
      latePayments: 0,
      inquiries: 0,
      publicRecords: 0,
    },
  };

  try {
    if (pdfBuffer.length === 0) {
      return {
        ok: false,
        text: "",
        error: "Empty file uploaded.",
        debug,
      };
    }

    // Check PDF header
    debug.headerOk = pdfBuffer.slice(0, 4).toString() === "%PDF";

    if (!debug.headerOk) {
      return {
        ok: false,
        text: "",
        error: "This upload does not appear to be a real PDF file.",
        debug,
      };
    }

    let textParts: string[] = [];
    let totalPages = 0;

    // Verify PDFParse is properly imported
    if (typeof PDFParse !== "function") {
      const parserCheckError = `Parser setup error: pdf-parse import is incorrect (typeof PDFParse: ${typeof PDFParse})`;
      debug.errors.push(parserCheckError);
      console.error("[PDF]", parserCheckError);
      return {
        ok: false,
        text: "",
        error: parserCheckError,
        debug,
      };
    }

    // STRATEGY 1: PDFParse v2 class-based extraction
    let parser: any = null;
    try {
      console.log("[PDF] Attempting PDFParse v2 extraction...");
      parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
      const result = await parser.getText();

      totalPages = result.total || 0;
      const extractedText = result.text || "";

      if (extractedText.trim().length > 0) {
        textParts.push(extractedText);
        debug.parsersUsed.push("pdf-parse-v2");
        debug.pagesRead = totalPages;
        console.log(`[PDF] PDFParse v2 succeeded: ${totalPages} pages, ${extractedText.length} chars`);
      }

      if (result.pages && result.pages.length > 0) {
        console.log(`[PDF] Pages extracted: ${result.pages.length}`);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debug.errors.push(`pdf-parse failed: ${errorMsg}`);
      console.warn("[PDF] pdf-parse failed:", errorMsg);
    } finally {
      if (parser) {
        try { await parser.destroy(); } catch (_) {}
      }
    }

    // Combine all extracted text
    let combinedText = textParts.join("\n\n");

    // Preprocess the text
    combinedText = preprocessText(combinedText);
    debug.charCount = combinedText.length;

    // Extract credit data patterns
    if (combinedText.length > 0) {
      const creditData = extractCreditData(combinedText);
      debug.creditDataFound = {
        scores: creditData.scores,
        collections: creditData.collections,
        chargeOffs: creditData.chargeOffs,
        latePayments: creditData.latePayments,
        inquiries: creditData.inquiries,
        publicRecords: creditData.publicRecords,
      };
      console.log(`[PDF] Credit data detected:`, debug.creditDataFound);
      if (creditData.hasBankruptcy) {
        console.log(`[PDF] Bankruptcy detected: ${creditData.bankruptcyChapter}`);
      }
    }

    // VALIDATION: Fail only if NO text was extracted OR no valid PDF header
    if (debug.charCount === 0 || debug.parsersUsed.length === 0) {
      return {
        ok: false,
        text: "",
        error:
          "No text could be extracted from the PDF. The file may be image-based or corrupted. Try uploading a text-based credit report PDF.",
        debug,
      };
    }

    // SUCCESS: Continue with whatever text we got
    console.log(
      `[PDF] Successfully extracted ${debug.charCount} chars using ${debug.parsersUsed.join(", ")}`
    );

    return {
      ok: true,
      text: combinedText,
      debug,
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    debug.errors.push(`Unexpected error: ${errorMsg}`);
    console.error("[PDF] Unexpected parsing error:", errorMsg);
    return {
      ok: false,
      text: "",
      error: `Unexpected PDF processing error: ${errorMsg}`,
      debug,
    };
  }
}

async function seedSettings() {
  const settings = await storage.getSettings();
  if (!settings) {
    // Already seeded by default in storage.ts initialization
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedSettings();

  
  app.get(api.reports.list.path, async (req, res) => {
    const reports = await storage.getReports();
    res.json(reports);
  });

  app.get(api.reports.get.path, async (req, res) => {
    const report = await storage.getReport(Number(req.params.id));
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }
    res.json(report);
  });

  app.get(api.settings.get.path, async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.put(api.settings.update.path, async (req, res) => {
    try {
      const input = api.settings.update.input!.parse(req.body);
      const settings = await storage.updateSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal error" });
    }
  });

  app.post(api.reports.process.path, upload.single("reportFile"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "PDF report file is required" });
      }

      // Parse the form fields
      const { clientName, reportDate, coachNotes, consentConfirmed } = req.body;
      const isConsentConfirmed = consentConfirmed === 'true' || consentConfirmed === true;
      
      if (!clientName || !reportDate || !isConsentConfirmed) {
        return res.status(400).json({ message: "Missing required fields or consent" });
      }

      // 1. Parse PDF with debug info
      console.log(`[Upload] Processing file: ${req.file.originalname}, size: ${req.file.size}, mime: ${req.file.mimetype}`);
      const parseResult = await parsePdfFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      // Log debug info server-side
      console.log("[Upload] Parse debug:", JSON.stringify(parseResult.debug, null, 2));

      if (!parseResult.ok) {
        console.warn(`[Upload] PDF parsing failed: ${parseResult.error}`);
        return res.status(400).json({
          message: parseResult.error,
          debug: parseResult.debug,
        });
      }

      const extractedText = parseResult.text;
      console.log(`[Upload] Successfully extracted ${extractedText.length} chars`);

      // 2. Pre-extract collection blocks with real company names
      const collectionBlocks = extractCollectionBlocks(extractedText);
      const trustedCollectionBlocks = getTrustedCollectionBlocks(collectionBlocks);

      // 3. Fetch current expert settings
      const settings = await storage.getSettings();

      // 4. AI Reasoning Layer - send text to OpenAI
      console.log("[AI] Sending text to OpenAI for analysis...");

      let preExtractedSection = '';
      if (trustedCollectionBlocks.length > 0) {
        preExtractedSection = `
PRE-EXTRACTED COLLECTION ACCOUNTS (use these exact names):
${trustedCollectionBlocks.map((b, i) => `  ${i + 1}. Company: "${sanitizeCompanyCandidate(b.companyName)}" | Account#: "${maskAccountNumber(b.accountNumber) || 'N/A'}" | Issue: Collection`).join('\n')}

IMPORTANT: Use the exact company names listed above for collection accounts in the negativeAccounts array. Do NOT rename them to "Unknown Collection" or any placeholder.
`;
      }

      const prompt = `
You are an expert credit consultant. Analyze this credit report and produce a SHORT, checklist-style 30-Day Credit Plan.

Client Name: ${clientName}
Report Date: ${reportDate}
Coach Notes: ${coachNotes || "None"}

Expert Settings:
Dispute Philosophy: ${settings.disputePhilosophy}
Dispute Order: ${settings.disputeOrder}
Credit Building: ${settings.creditBuildingRecommendations}

Credit Report Text (First 20k chars):
${extractedText.substring(0, 20000)}
${preExtractedSection}
NEGATIVE ACCOUNT DETECTION RULES:
Detect ALL negative accounts using these criteria:
1. Status fields: "charge off", "collection", "included in bankruptcy", "derogatory", "late payment", "public record"
2. Account sections: "Collection", "Public Records", "Derogatory Accounts", "Negative Accounts"
3. PUBLIC RECORDS: Bankruptcy (Chapter 7, Chapter 13), tax liens, judgments MUST always be listed as negative accounts with issueType "Bankruptcy Public Record" or "Public Record"
4. Any account marked "derogatory" or "included in bankruptcy" is negative even if balance is $0

CRITICAL: Each negativeAccount entry MUST be a REAL tradeline/account with a real company name.
DO NOT include any of these as account entries:
- Bureau headers (TransUnion, Experian, Equifax)
- Status rows like "Reported Yes Yes Yes"
- Classification lines like "Creditor Classification Unknown"
- Explanatory text, tips, or sentences from the report
- Summary lines or section labels
- Any text that is not a real creditor/company name
Each accountName must be a real business (e.g. "CCI", "Capital One", "Portfolio Recovery").

BANKRUPTCY-SPECIFIC RULES (if bankruptcy detected):
- Include bankruptcy as a negative account entry (e.g. accountName: "U.S. Bankruptcy Court", issueType: "Bankruptcy Public Record")
- In the action plan, include: "Dispute tradelines not marked 'included in bankruptcy' with $0 balance in Round 1."
- In the action plan, include: "Verify all bankruptcy accounts show $0 balance, correct discharge date, and proper notation."
- If reporting is inconsistent across bureaus, include: "Dispute bankruptcy reporting inconsistencies under FCRA accuracy requirements."

RULES FOR THE ACTION PLAN:
- Each step must be ONE sentence only, max 25 words
- No motivational text, no paragraphs, no legal explanations
- Maximum 6 steps per week
- Total action plan under 250 words
- Prioritize in this exact order: 1) Collections 2) Charge-offs 3) Bankruptcy reporting issues 4) Late payments 5) Inquiries
- Only include actions relevant to detected issues

Generate a structured JSON response matching this schema:
{
  "clientName": "${clientName}",
  "reportDate": "${reportDate}",
  "diagnosisSummary": "2-3 SHORT sentences summarizing findings including public records if any",
  "counts": {
    "latePayments": number,
    "collections": number,
    "chargeOffs": number,
    "inquiries": number,
    "publicRecords": number
  },
  "negativeAccounts": [
    {
      "accountName": "REAL company/creditor name from the report (NEVER use 'Unknown Collection' or placeholder names)",
      "accountNumberMasked": "string (last 4 only or case number)",
      "issueType": "Collection | Charge-off | Bankruptcy Public Record | Public Record | Late Payment | Inquiry",
      "priority": "High | Medium | Low"
    }
  ],
  "disputeStrategy": {
    "challengeBasis": ["Accuracy", "Completeness", "etc"],
    "timeline": "30-45 days",
    "expectedOutcomes": ["short outcome", "short outcome"]
  },
  "actionPlan": {
    "week1": ["action step", "action step", "action step"],
    "week2": ["action step", "action step", "action step"],
    "week3": ["action step", "action step", "action step"],
    "week4": ["action step", "action step", "action step"]
  },
  "creditBuilding": {
    "recommendations": ["short recommendation", "short recommendation"]
  },
  "accountabilityNote": "One strong closing sentence"
}
`;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const generatedPlanStr = aiResponse.choices[0]?.message?.content || "{}";
      const generatedPlan = JSON.parse(generatedPlanStr);

      // 5. Post-processing: filter junk rows, then restore trusted extracted account rows.
      const rawNegativeAccounts = Array.isArray(generatedPlan.negativeAccounts)
        ? generatedPlan.negativeAccounts
        : [];
      const before = rawNegativeAccounts.length;
      generatedPlan.negativeAccounts = filterNegativeAccounts(rawNegativeAccounts);
      const filtered = generatedPlan.negativeAccounts.length;
      generatedPlan.negativeAccounts = mergePreExtractedCollectionAccounts(generatedPlan.negativeAccounts, trustedCollectionBlocks);
      const after = generatedPlan.negativeAccounts.length;
      console.log(`[Filter] Negative accounts: ${before} raw → ${filtered} validated → ${after} after extracted-account repair`);

      updateNegativeAccountCounts(generatedPlan);

      // 6. Save to Database
      const report = await storage.createReport({
        clientName,
        reportDate,
        coachNotes: coachNotes || null,
        consentConfirmed: isConsentConfirmed,
        extractedText,
        generatedPlan,
      });

      res.status(201).json(report);
    } catch (error) {
      console.error("Processing error:", error);
      res.status(500).json({ message: "Failed to process report" });
    }
  });

  app.get(api.reports.downloadPdf.path, async (req, res) => {
    try {
      const report = await storage.getReport(Number(req.params.id));
      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      const plan = report.generatedPlan as any;

      // Generate PDF (bufferPages required for footer on all pages)
      const doc = new PDFDocument({ margin: 50, bufferPages: true });
      const filename = `${plan.clientName.replace(/\s+/g, '_')}_30_day_credit_plan.pdf`;

      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'application/pdf');

      doc.pipe(res);

      // =====================================================
      // LAYER 1: FIXED TEMPLATE (never modified by AI)
      // LAYER 2: DYNAMIC AI CONTENT (filled from plan data)
      // =====================================================

      // --- HEADER (FIXED) ---
      doc.font('Helvetica-Bold').fontSize(20).text('CLIENT CREDIT ANALYSIS', { align: 'center' });
      doc.font('Helvetica').fontSize(9).text('Rose Finance Academy', { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(12).text(`Client Name: ${plan.clientName}`);
      doc.text(`Credit Report Date: ${plan.reportDate}`);
      doc.moveDown();

      // --- SECTION 1: CREDIT OVERVIEW (DYNAMIC) ---
      doc.font('Helvetica-Bold').fontSize(16).text('SECTION 1: CREDIT OVERVIEW');
      doc.font('Helvetica').fontSize(12).text(plan.diagnosisSummary);
      doc.moveDown();
      doc.font('Helvetica').fontSize(10);
      doc.text(`Collections: ${plan.counts.collections}    Charge-offs: ${plan.counts.chargeOffs}    Public Records: ${plan.counts.publicRecords || 0}    Late Payments: ${plan.counts.latePayments}    Inquiries: ${plan.counts.inquiries}`);
      doc.moveDown();

      // --- SECTION 2: NEGATIVE ACCOUNTS IDENTIFIED (DYNAMIC) ---
      doc.font('Helvetica-Bold').fontSize(16).text('SECTION 2: NEGATIVE ACCOUNTS IDENTIFIED');
      doc.font('Helvetica').fontSize(10);
      
      const tableTop = doc.y + 10;
      doc.font('Helvetica-Bold');
      doc.text('Account Name', 50, tableTop);
      doc.text('Account Number', 250, tableTop);
      doc.text('Issue', 400, tableTop);
      
      let y = tableTop + 20;
      doc.font('Helvetica');
      for (const account of plan.negativeAccounts) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.text(account.accountName, 50, y);
        doc.text(account.accountNumberMasked, 250, y);
        doc.text(account.issueType, 400, y);
        y += 20;
      }
      doc.y = y;
      doc.moveDown();

      // --- SECTION 3: DISPUTE STRATEGY (DYNAMIC) ---
      doc.font('Helvetica-Bold').fontSize(16).text('SECTION 3: DISPUTE STRATEGY', 50);
      doc.font('Helvetica').fontSize(12);
      doc.text(`Timeline: ${plan.disputeStrategy.timeline}`);
      doc.text(`Challenge Basis: ${plan.disputeStrategy.challengeBasis.join(", ")}`);
      doc.moveDown();

      // --- SECTION 4: 30-DAY ACTION PLAN (DYNAMIC) ---
      doc.font('Helvetica-Bold').fontSize(16).text('SECTION 4: 30-DAY ACTION PLAN');
      doc.moveDown(0.5);

      const weeks = [
        { label: 'Week 1 (Days 1-7)', items: plan.actionPlan.week1 },
        { label: 'Week 2 (Days 8-14)', items: plan.actionPlan.week2 },
        { label: 'Week 3 (Days 15-21)', items: plan.actionPlan.week3 },
        { label: 'Week 4 (Days 22-30)', items: plan.actionPlan.week4 },
      ];

      for (const week of weeks) {
        if (doc.y > 680) { doc.addPage(); }
        doc.font('Helvetica-Bold').fontSize(11).text(week.label);
        doc.font('Helvetica').fontSize(10);
        const items = Array.isArray(week.items) ? week.items : [week.items];
        for (const item of items) {
          if (item) doc.text(`  \u2022 ${item}`, { indent: 10 });
        }
        doc.moveDown(0.5);
      }

      // AI-generated credit building recommendations
      const creditRecs = Array.isArray(plan.creditBuilding.recommendations) ? plan.creditBuilding.recommendations : [plan.creditBuilding.recommendations];
      if (creditRecs.length > 0 && creditRecs[0]) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(11).text('Credit Building Recommendations');
        doc.font('Helvetica').fontSize(10);
        for (const rec of creditRecs) {
          if (rec) doc.text(`  \u2022 ${rec}`, { indent: 10 });
        }
      }
      doc.moveDown();

      // --- SECTION 5: RESOURCES & TRAINING LINKS (FIXED — NEVER AI-GENERATED) ---
      if (doc.y > 580) { doc.addPage(); }
      doc.font('Helvetica-Bold').fontSize(16).text('SECTION 5: RESOURCES & TRAINING LINKS');
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(11).text('Dispute Letters & Methods');
      doc.font('Helvetica').fontSize(10);
      doc.moveDown(0.3);

      doc.text('1. Round 1 Letter');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=3bb0c48048a94417bee271ec5f99bb21', { link: 'https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=3bb0c48048a94417bee271ec5f99bb21', underline: true });
      doc.fillColor('#000000').moveDown(0.3);

      doc.font('Helvetica').fontSize(10).text('2. 7-Day Deletion Method');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=6740a676535846689642e3f0bc9485a3', { link: 'https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=6740a676535846689642e3f0bc9485a3', underline: true });
      doc.fillColor('#000000').moveDown(0.3);

      doc.font('Helvetica').fontSize(10).text('3. Round 2 Letter');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=2b47934c79b74458b0c8f30396deb22f', { link: 'https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=2b47934c79b74458b0c8f30396deb22f', underline: true });
      doc.fillColor('#000000').moveDown(0.3);

      doc.font('Helvetica').fontSize(10).text('4. Late Payments');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=34c7865c1b3e4500a95a9664b3fb1c70', { link: 'https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=34c7865c1b3e4500a95a9664b3fb1c70', underline: true });
      doc.fillColor('#000000').moveDown(0.3);

      doc.font('Helvetica').fontSize(10).text('5. Student Loan Late Payments');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://www.skool.com/rosefinanceacademy/student-loan-relief-late-payment-edition?p=e42ed538', { link: 'https://www.skool.com/rosefinanceacademy/student-loan-relief-late-payment-edition?p=e42ed538', underline: true });
      doc.fillColor('#000000').moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(11).text('Credit Building Tools');
      doc.font('Helvetica').fontSize(10);
      doc.moveDown(0.3);

      doc.text('6. Kovo Credit Builder ($10/mo)');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://kovo-credit.sjv.io/XYNNOX', { link: 'https://kovo-credit.sjv.io/XYNNOX', underline: true });
      doc.fillColor('#000000').moveDown(0.3);

      doc.text('7. Ava Credit Building ($9/mo)');
      doc.font('Helvetica').fontSize(9).fillColor('#1a56db')
        .text('https://meetava.sjv.io/rose', { link: 'https://meetava.sjv.io/rose', underline: true });
      doc.fillColor('#000000').moveDown();

      // --- CLOSING (DYNAMIC) ---
      doc.font('Helvetica-Oblique').fontSize(9).text(plan.accountabilityNote);
      
      // Footer on all pages
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).text(
          `Confidential - Generated for ${plan.clientName} by Rose Finance Academy`,
          50,
          doc.page.height - 50,
          { align: 'center', width: doc.page.width - 100 }
        );
      }

      doc.end();
    } catch (error) {
      console.error("PDF generation error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate PDF" });
      }
    }
  });

  return httpServer;
}
