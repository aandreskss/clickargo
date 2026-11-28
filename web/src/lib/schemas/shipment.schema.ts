import { z } from "zod";
import { STAGE_KEYS } from "@/lib/stage-rules";
import { SERVICE_TYPES } from "@/lib/schemas/quote.schema";

const UUID = z.string().uuid();
const dateRegex = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));
const optText = (max = 500) => z.string().max(max).optional().or(z.literal(""));

// ── Paso 1: Cliente y tipo de servicio ────────────────────────────────────────
export const CreateShipmentStep1Schema = z.object({
  account_id:   UUID,
  service_type: z.enum(SERVICE_TYPES),
  quote_id:     UUID.optional().or(z.literal("")),
});

// ── Paso 2: Ruta, carga y contenedores ────────────────────────────────────────
export const UpdateShipmentStep2Schema = z.object({
  id:                  UUID,
  origin_port_id:      z.string().min(2).max(10).optional().or(z.literal("")),
  destination_port_id: z.string().min(2).max(10).optional().or(z.literal("")),
  incoterm:            z.string().max(5).optional().or(z.literal("")),
  carrier_account_id:  UUID.optional().or(z.literal("")),
  cargo_description:   optText(1000),
  packages:            z.coerce.number().int().positive().optional().or(z.literal("")),
  weight_kg:           z.coerce.number().nonnegative().optional().or(z.literal("")),
  volume_cbm:          z.coerce.number().nonnegative().optional().or(z.literal("")),
  // containers: JSON blob, se parsea por separado con ContainerSchema
});

// ── Paso 3: Fechas y referencias ──────────────────────────────────────────────
export const UpdateShipmentStep3Schema = z.object({
  id:                       UUID,
  booking_number:           optText(100),
  bl_number:                optText(100),
  vessel_or_flight:         optText(200),
  voyage:                   optText(100),
  etd:                      dateRegex,
  eta:                      dateRegex,
  customer_reference:       optText(200),
  shipper_account_id:       UUID.optional().or(z.literal("")),
  consignee_account_id:     UUID.optional().or(z.literal("")),
  notify_party_account_id:  UUID.optional().or(z.literal("")),
  notes:                    optText(2000),
  internal_notes:           optText(2000),
  // AJ1: agente de origen y origen del HBL
  origin_agent_account_id:  UUID.optional().or(z.literal("")),
  hbl_issued_by:            z.enum(["us", "origin_agent"]).optional().or(z.literal("")),
  // AJ1: gestión aduanal
  customs_managed:          z.coerce.boolean().optional(),
  customs_user_id:          UUID.optional().or(z.literal("")),
});

// ── Avance de etapa ───────────────────────────────────────────────────────────
const advanceableStages = STAGE_KEYS.filter((s) => s !== "draft") as [
  string,
  ...string[]
];

export const AdvanceStageSchema = z.object({
  id:       UUID,
  to_stage: z.enum(advanceableStages as [string, ...string[]]),
  reason:   optText(500),
});

// ── Cancelar embarque ─────────────────────────────────────────────────────────
export const CancelShipmentSchema = z.object({
  id:     UUID,
  reason: z.string().min(1).max(500),
});

// ── Convertir cotización ──────────────────────────────────────────────────────
export const ConvertQuoteSchema = z.object({
  quote_id: UUID,
});

// ── Contenedor individual ─────────────────────────────────────────────────────
export const ContainerSchema = z.object({
  container_number:  optText(20),
  container_type_id: optText(10),
  seal_number:       optText(50),
  weight_kg:         z.coerce.number().nonnegative().optional().or(z.literal("")),
  notes:             optText(500),
});

// ── Fechas aduanales (importación) + exportación ──────────────────────────────
export const UpdateShipmentDatesSchema = z.object({
  id:                     UUID,
  // Importación — aduana
  declaracion_num:        optText(100),
  liquidacion_num:        optText(100),
  declaracion_date:       dateRegex,
  arrival_manifest_date:  dateRegex,
  verificacion_date:      dateRegex,
  caja_request_date:      dateRegex,
  igra_num:               optText(100),
  igra_date:              dateRegex,
  despacho_date:          dateRegex,
  // Exportación
  booking_date:           dateRegex,
  container_cutoff_date:  dateRegex,
  docs_cutoff_date:       dateRegex,
  container_return_date:  dateRegex,
  vgm_date:               dateRegex,
});

export type UpdateShipmentDatesInput  = z.infer<typeof UpdateShipmentDatesSchema>;
export type CreateShipmentStep1Input  = z.infer<typeof CreateShipmentStep1Schema>;
export type ServiceType               = z.infer<typeof CreateShipmentStep1Schema>["service_type"];
export type UpdateShipmentStep2Input  = z.infer<typeof UpdateShipmentStep2Schema>;
export type UpdateShipmentStep3Input  = z.infer<typeof UpdateShipmentStep3Schema>;
export type AdvanceStageInput         = z.infer<typeof AdvanceStageSchema>;
export type CancelShipmentInput       = z.infer<typeof CancelShipmentSchema>;
export type ContainerInput            = z.infer<typeof ContainerSchema>;
