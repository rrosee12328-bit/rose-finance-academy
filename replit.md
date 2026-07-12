# Rose Finance Academy - 30-Day Credit Plan Generator

## Overview
A professional credit coaching web app where coaches upload MyFreeScoreNow credit report PDFs, extract text via AI analysis, and generate structured 30-day coaching plans with dispute strategies.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (dark luxury pink theme)
- **Backend**: Express.js (TypeScript, ESM)
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: OpenAI (gpt-5.1) via Replit AI Integrations
- **PDF Parsing**: pdf-parse v2.4.5 (class-based API: `new PDFParse({ data })` → `getText()` → `destroy()`)
- **PDF Generation**: pdfkit (CJS, loaded via `createRequire`)

## Key Files
- `shared/schema.ts` - Database schema (creditReports table), Zod types, API contracts
- `shared/routes.ts` - API route definitions and response schemas
- `server/routes.ts` - Express routes: PDF upload/parse, AI analysis, PDF download, settings CRUD
- `server/storage.ts` - Storage interface (IStorage) and DatabaseStorage implementation
- `server/db.ts` - Drizzle database connection
- `client/src/pages/NewReport.tsx` - Upload form with drag-drop, debug info panel
- `client/src/pages/Dashboard.tsx` - Reports list
- `client/src/pages/ReportDetails.tsx` - Individual report view + PDF download
- `client/src/pages/Settings.tsx` - Strategy settings editor
- `client/src/hooks/use-reports.ts` - TanStack Query hooks for all API calls
- `client/src/index.css` - Theme variables (dark luxury pink brand palette)
- `tailwind.config.ts` - Custom font families (sans, display), color tokens

## Brand Palette (Rose Finance Academy)
- Primary Pink: `#F472B6` (HSL `330 86% 70%`) — buttons, active nav, icons, accent text
- Bright Pink Hover: `#EC4899` — button hover states
- Pink Glow: `rgba(244, 114, 182, 0.18)` — button shadows, drag zone, active nav background
- Pink Border: `rgba(244, 114, 182, 0.35)` — accent borders, dividers
- Light Pink: `#FBCFE8` — gradient text endpoints
- Background: `#081225` — body/page background
- Card: `#0B1730` — glass-card backgrounds
- Card Alt: `#101C3A` — secondary cards
- Priority badges: High=strong pink, Medium=soft pink outline, Low=muted slate
- Buttons: pink bg + white text + brand-glow shadow + hover scale animation
- Sidebar: branded logo block with gradient accent line, pink active state with left border

## PDF Parsing (pdf-parse v2.4.5)
- Exported as `{ PDFParse }` class, NOT a default callable function
- Usage: `new PDFParse({ data: buffer, verbosity: 0 })` → `await parser.getText()` → `await parser.destroy()`
- `getText()` returns `{ pages: [{text, num}], text: "combined", total: numPages }`
- Always wrap in try/finally to call `destroy()` for resource cleanup
- CJS import via `createRequire` due to ESM project

## Action Plan Structure
- AI generates checklist-style 30-day plan with `week1`, `week2`, `week3`, `week4` arrays (max 6 steps each, 25 words per step)
- Priority order: Collections → Charge-offs → Bankruptcy reporting issues → Late payments → Inquiries
- `creditBuilding.recommendations` is an array of short strings
- PDF renders weeks as bullet checklists + resource links + credit building section
- Frontend renders `WeekChecklist` components per week

## Negative Account Detection
- Detects: collections, charge-offs, late payments, inquiries, AND public records (bankruptcy, tax liens, judgments)
- Public records keywords: bankruptcy, chapter 7/13, US bankruptcy court, public record, court record, bk7, bk13, tax lien, civil judgment
- Derogatory/included-in-bankruptcy accounts detected even with $0 balance
- Bankruptcy triggers specific action plan steps (verify $0 balances, discharge dates, FCRA accuracy disputes)
- `counts.publicRecords` field in schema (with `.default(0)` for backward compat)
- Issue types: Collection | Charge-off | Bankruptcy Public Record | Public Record | Late Payment | Inquiry

## PDF 2-Layer Architecture
- **Layer 1 (Fixed Template)**: Header, Section 5 resource links — NEVER AI-generated
- **Layer 2 (Dynamic AI)**: Sections 1-4 filled from AI plan data
- All 7 Skool/affiliate links always render unconditionally in Section 5
- AI boolean flags (`round1Recommended`, `kovoRecommended`, etc.) removed from schema and prompt
- PDF structure: Section 1 (Credit Overview) → Section 2 (Negative Accounts) → Section 3 (Dispute Strategy) → Section 4 (30-Day Action Plan) → Section 5 (Resources & Training Links)

## Negative Account Validation (Post-AI Filter)
- `filterNegativeAccounts()` runs after AI response, before database save
- `computeAccountConfidence()` scores each row: +40 real company name, +30 account number, +30 valid issue type
- Rejects rows below 70% confidence (junk phrases, long sentences, bureau headers, repeated words)
- JUNK_PHRASES array catches: "reported yes/no", "classification", "summary", tips, sentences, section labels
- After filtering, counts are recalculated from the validated account list
- Logs KEPT/REJECTED decisions with confidence scores

## Collection Block Extraction
- `extractCollectionBlocks()` uses sliding window (2 lines above, 3 below) around each "collection" keyword
- `scoreCompanyName()` ranks candidates: known collectors (+30), uppercase (+10), title case (+5), business suffixes (+15)
- Rejects: bureau headers, generic labels, dates, dollar amounts, pure numbers
- Deduplication by normalized name AND account number
- Pre-extracted blocks injected into AI prompt so it uses real company names, not placeholders
- Debug output logs extracted company names and line indices (no raw PII)

## Important Notes
- OpenAI client imported from `server/replit_integrations/audio/client.ts`
- Strategy settings stored in-memory (DatabaseStorage), not DB
- Font: Playfair Display (display headings) + Inter (body) via Google Fonts
- CSS variable `--font-display` mapped to `font-display` in Tailwind config
- Pattern matching extracts credit scores, collections, charge-offs, late payments, inquiries from PDF text
- Debug panel in upload UI shows file info, parser results, credit data detected
- pdfkit requires `bufferPages: true` for `switchToPage()` footer rendering
