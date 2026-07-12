import { pgTable, text, serial, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const creditReports = pgTable("credit_reports", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  reportDate: text("report_date").notNull(),
  coachNotes: text("coach_notes"),
  consentConfirmed: boolean("consent_confirmed").notNull(),
  // Extracted raw text
  extractedText: text("extracted_text").notNull(),
  // JSON structure of the generated plan
  generatedPlan: jsonb("generated_plan").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreditReportSchema = createInsertSchema(creditReports).omit({
  id: true,
  createdAt: true,
});

export type InsertCreditReport = z.infer<typeof insertCreditReportSchema>;
export type CreditReport = typeof creditReports.$inferSelect;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- API CONTRACT TYPES ---
// What the frontend sends to process a PDF
export const processReportSchema = z.object({
  clientName: z.string().min(1, "Client name is required"),
  reportDate: z.string().min(1, "Report date is required"),
  coachNotes: z.string().optional(),
  consentConfirmed: z.boolean().refine(val => val === true, "Must confirm consent"),
  // Note: PDF is uploaded as multipart/form-data, but we type the response here
});
export type ProcessReportRequest = z.infer<typeof processReportSchema>;

// The AI-generated plan structure
export const negativeAccountSchema = z.object({
  accountName: z.string(),
  accountNumberMasked: z.string(),
  issueType: z.string(), // "Late Payment", "Collection - 7 day method", etc.
  priority: z.enum(["High", "Medium", "Low"]),
});

export const creditPlanSchema = z.object({
  clientName: z.string(),
  reportDate: z.string(),
  diagnosisSummary: z.string(),
  // Totals
  counts: z.object({
    latePayments: z.number(),
    collections: z.number(),
    chargeOffs: z.number(),
    inquiries: z.number(),
    publicRecords: z.number().default(0),
  }),
  negativeAccounts: z.array(negativeAccountSchema),
  disputeStrategy: z.object({
    challengeBasis: z.array(z.string()),
    timeline: z.string(),
    expectedOutcomes: z.array(z.string()),
  }),
  actionPlan: z.object({
    week1: z.array(z.string()),
    week2: z.array(z.string()),
    week3: z.array(z.string()),
    week4: z.array(z.string()),
  }),
  creditBuilding: z.object({
    recommendations: z.array(z.string()),
  }),
  accountabilityNote: z.string(),
});

export type CreditPlan = z.infer<typeof creditPlanSchema>;
export type NegativeAccount = z.infer<typeof negativeAccountSchema>;

// Settings schema for customization (saved in memory or DB later)
export const strategySettingsSchema = z.object({
  disputePhilosophy: z.string(),
  creditBuildingRecommendations: z.string(),
  clientEducationMessaging: z.string(),
  disputeOrder: z.string(),
});
export type StrategySettings = z.infer<typeof strategySettingsSchema>;
