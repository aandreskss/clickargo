import { z } from "zod";

const SERVICE_TYPES = [
  "mar_import",
  "mar_export",
  "aire_import",
  "aire_export",
  "aduana",
  "transporte",
] as const;

export const ReportFiltersSchema = z.object({
  year: z.coerce.number().int().min(2024).max(2030).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  mode: z.enum(["ocean", "air"]).optional(),
  direction: z.enum(["import", "export"]).optional(),
  service_type: z.enum(SERVICE_TYPES).optional(),
  account_id: z.string().uuid().optional(),
  group_by: z.enum(["cliente", "ruta", "mes"]).default("cliente"),
});

export type ReportFilters = z.infer<typeof ReportFiltersSchema>;

export const REPORT_NAMES = [
  "embarques-por-etapa",
  "puntualidad",
  "embudo-cotizaciones",
  "rentabilidad",
] as const;

export type ReportName = (typeof REPORT_NAMES)[number];
