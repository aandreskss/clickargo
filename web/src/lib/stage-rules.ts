// stage-rules.ts
// Reglas de avance de etapas para embarques.
// Lógica pura sin imports de Supabase ni Next.js — testeable con Vitest.

export const STAGE_KEYS = [
  "draft",
  "booked",
  "picked_up",
  "at_origin",
  "in_transit",
  "at_destination",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export const TERMINAL_STAGES = new Set<StageKey>(["completed", "cancelled"]);

// Secuencia de avance (sin etapas terminales al final del flujo normal).
// cancelled puede alcanzarse desde cualquier etapa.
const FORWARD_SEQUENCE: StageKey[] = [
  "draft",
  "booked",
  "picked_up",
  "at_origin",
  "in_transit",
  "at_destination",
  "out_for_delivery",
  "delivered",
  "completed",
];

/** Siguiente etapa en la secuencia normal. Null si es terminal o no hay siguiente. */
export function nextStage(current: StageKey): StageKey | null {
  if (TERMINAL_STAGES.has(current)) return null;
  const idx = FORWARD_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === FORWARD_SEQUENCE.length - 1) return null;
  return FORWARD_SEQUENCE[idx + 1];
}

/** Campos requeridos en el embarque ANTES de poder entrar a la etapa indicada. */
export function requiredFieldsForStage(stage: StageKey): string[] {
  switch (stage) {
    case "draft":
      return [];
    case "booked":
      return ["account_id", "mode", "direction", "origin_port_id", "destination_port_id"];
    case "picked_up":
      return ["carrier_account_id", "booking_number"];
    case "at_origin":
      return ["etd"];
    case "in_transit":
      return ["etd"];
    case "at_destination":
      return ["eta"];
    case "out_for_delivery":
      return [];
    case "delivered":
      return ["ata"];
    case "completed":
      return [];
    case "cancelled":
      return [];
    default:
      return [];
  }
}

export type ShipmentFields = {
  account_id?: string | null;
  mode?: string | null;
  direction?: string | null;
  origin_port_id?: string | null;
  destination_port_id?: string | null;
  carrier_account_id?: string | null;
  booking_number?: string | null;
  etd?: string | null;
  eta?: string | null;
  atd?: string | null;
  ata?: string | null;
};

/**
 * Evalúa si un embarque cumple los requisitos para avanzar a toStage.
 * No verifica permisos de rol — eso es responsabilidad de la Server Action.
 */
export function canAdvance(
  shipment: ShipmentFields,
  toStage: StageKey
): { ok: true } | { ok: false; missing: string[] } {
  const required = requiredFieldsForStage(toStage);
  const missing = required.filter(
    (f) => !shipment[f as keyof ShipmentFields]
  );
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

/** Solo owner, admin y manager pueden retroceder una etapa. */
export function canRollback(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/** Índice de posición en la secuencia de avance (para detectar retrocesos). */
export function stageIndex(stage: StageKey): number {
  return FORWARD_SEQUENCE.indexOf(stage);
}

/** True si toStage es un retroceso desde fromStage. */
export function isRollback(fromStage: StageKey, toStage: StageKey): boolean {
  if (toStage === "cancelled") return false; // cancelar no es retroceso
  return stageIndex(toStage) < stageIndex(fromStage);
}
