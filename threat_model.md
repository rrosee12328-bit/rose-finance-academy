# Threat Model

## Project Overview

Rose Finance Academy is a credit-coaching web application that lets a coach upload a client credit-report PDF, extract the report text, send that text to an LLM for analysis, store the generated 30-day credit plan in PostgreSQL, and later view or download the plan as a PDF. The production stack is a React/Vite frontend served by an Express/TypeScript backend with PostgreSQL via Drizzle.

This application handles highly sensitive financial and personal data. The primary production security question is whether uploaded credit-report data, generated plans, and coach configuration are exposed to unauthorized parties or can be abused to consume server or third-party AI resources.

Production scoping assumptions for future scans:
- `NODE_ENV=production` in deployed environments.
- The mockup sandbox is never production.
- The app is currently not deployed; if later deployed with public visibility, its HTTP endpoints should be treated as internet-reachable.
- Areas that are present in the repo but not registered by `server/index.ts` / `server/routes.ts` should be treated as dev-only or dormant until production reachability is demonstrated.

## Assets

- **Uploaded credit-report contents** — raw extracted report text, account history, derogatory items, and public-record details. This is the most sensitive asset in the system.
- **Generated credit plans and negative-account summaries** — derived financial guidance tied to a named client. Exposure leaks sensitive client financial condition and dispute strategy.
- **Client identifiers and metadata** — client names, report dates, and coach notes. These link report data to an identifiable person.
- **AI integration credentials and quota** — OpenAI integration secrets and the billable model capacity behind them. Abuse can create direct cost and service exhaustion.
- **Coach strategy settings** — the dispute philosophy and workflow configuration used across reports. This is business-sensitive, but less sensitive than client report contents.
- **Database contents** — the complete `credit_reports` table is a single high-value repository of client financial records.
- **Operational logs** — request/response logs can become a secondary copy of report data if sensitive payloads are logged.

## Trust Boundaries

- **Browser to Express API** — all client input is untrusted. Multipart uploads, route params, and JSON bodies cross this boundary.
- **Express API to PostgreSQL** — report data and generated plans are stored server-side. Broken authorization or injection here would expose the full report corpus.
- **Express API to OpenAI integration** — the server forwards extracted report text to a third-party AI service using privileged credentials.
- **Public to coach boundary** — the product behaves like an internal coach console, so routes that expose reports or settings must not be implicitly public.
- **Production code to dormant/dev-only code** — modules under `server/replit_integrations/*/routes.ts` are currently not registered by the server entrypoint and should not drive findings unless their reachability changes.

## Scan Anchors

- Production entry points: `server/index.ts`, `server/routes.ts`, `server/storage.ts`, `server/db.ts`, `shared/routes.ts`, `shared/schema.ts`, `client/src/hooks/use-reports.ts`.
- Highest-risk code area: report upload/processing and retrieval in `server/routes.ts`, especially `/api/reports*` and `/api/settings`.
- Public vs authenticated surfaces: no authentication or session boundary is currently enforced anywhere in the reachable app or API.
- Usually ignore unless reachability is proven: `server/vite.ts`, `server/replit_integrations/*/routes.ts`, and other development-only helpers not imported by the production server.

## Threat Categories

### Spoofing

The current reachable application has no user authentication, session validation, or role separation. If this app is deployed publicly, any internet user can act as a coach. The system must require a valid authenticated coach identity before allowing access to report-processing, report-retrieval, PDF-download, or settings-management endpoints.

### Tampering

Coach settings and report-generation inputs are accepted directly from client requests. The server must treat the browser as untrusted, validate request bodies, and prevent unauthorized users from changing shared settings or generating records on behalf of the coach workflow.

### Information Disclosure

The application stores and returns full credit-report records, including extracted raw text and generated plans, and also emits API responses to server logs. The system must ensure that only the authorized coach can access stored reports, raw extracted text, generated PDFs, and settings, and it must avoid copying sensitive report data into logs or error payloads.

### Denial of Service

Report processing is resource-intensive: it accepts file uploads into memory, parses attacker-supplied PDFs, and sends extracted text to a paid LLM. The system must apply strict upload-size limits, request throttling, and abuse controls on public endpoints so attackers cannot exhaust memory, CPU, or AI quota.

### Elevation of Privilege

Because the app currently has no authenticated or per-user boundary, every reachable user effectively has the same privilege as an internal coach. The system must enforce server-side authorization on all report and settings routes, scope report access to the owning coach or tenant, and avoid exposing predictable identifiers that let one user enumerate another user's records.
