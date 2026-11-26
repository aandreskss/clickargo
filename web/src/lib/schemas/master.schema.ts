import { z } from "zod";

const UUID = z.string().uuid();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));
const optText = (max = 500) => z.string().max(max).optional().or(z.literal(""));

export const CreateMasterSchema = z.object({
  master_number:        z.string().min(1).max(100),
  mode:                 z.enum(["ocean", "air"]),
  carrier_account_id:   UUID.optional().or(z.literal("")),
  vessel_or_flight:     optText(100),
  voyage:               optText(50),
  origin_port_id:       z.string().max(10).optional().or(z.literal("")),
  destination_port_id:  z.string().max(10).optional().or(z.literal("")),
  etd:                  optDate,
  eta:                  optDate,
  notes:                optText(2000),
  tracking_enabled:     z.coerce.boolean().optional(),
  tracking_provider:    z.enum(["terminal49", "manual"]).optional().or(z.literal("")),
  tracking_ref:         optText(200),
});

export const UpdateMasterSchema = CreateMasterSchema.extend({
  id:  UUID,
  atd: optDate,
  ata: optDate,
});

export const LinkShipmentSchema = z.object({
  master_id:   UUID,
  shipment_id: UUID,
});

export const UnlinkShipmentSchema = z.object({
  shipment_id: UUID,
});

export const ManualTrackingEventSchema = z.object({
  master_id:   UUID,
  event_code:  z.string().min(1).max(100),
  event_label: z.string().min(1).max(300),
  location:    optText(200),
  occurred_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

export const SuggestionActionSchema = z.object({
  master_id: UUID,
});
