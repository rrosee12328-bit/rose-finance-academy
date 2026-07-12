import { z } from "zod";
import { insertCreditReportSchema, creditReports, processReportSchema, strategySettingsSchema, creditPlanSchema } from "./schema";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  reports: {
    list: {
      method: "GET" as const,
      path: "/api/reports" as const,
      responses: {
        200: z.array(z.custom<typeof creditReports.$inferSelect>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/reports/:id" as const,
      responses: {
        200: z.custom<typeof creditReports.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    process: {
      method: "POST" as const,
      path: "/api/reports/process" as const,
      // Input is multipart/form-data containing the processReportSchema fields + the PDF file
      responses: {
        201: z.custom<typeof creditReports.$inferSelect>(),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    downloadPdf: {
      method: "GET" as const,
      path: "/api/reports/:id/pdf" as const,
      // Returns application/pdf
      responses: {
        200: z.any(), // Blob/Buffer
        404: errorSchemas.notFound,
      },
    }
  },
  settings: {
    get: {
      method: "GET" as const,
      path: "/api/settings" as const,
      responses: {
        200: strategySettingsSchema,
      }
    },
    update: {
      method: "PUT" as const,
      path: "/api/settings" as const,
      input: strategySettingsSchema,
      responses: {
        200: strategySettingsSchema,
        400: errorSchemas.validation,
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type ReportResponse = z.infer<typeof api.reports.get.responses[200]>;
export type ReportsListResponse = z.infer<typeof api.reports.list.responses[200]>;
