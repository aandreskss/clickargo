// master-rules.ts
// Reglas de negocio para masters y tracking.
// Lógica pura sin imports de Supabase ni Next.js — testeable con Vitest.

import { STAGE_KEYS, type StageKey } from "./stage-rules";

const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  STAGE_KEYS.map((k, i) => [k, i + 1])
);

const TERMINAL_SET = new Set(["completed", "cancelled"]);

export type HouseForStage = { stage_key: string };

/**
 * Etapa del master = la más atrasada (sort_order mínimo) entre los houses activos.
 * Si no hay houses activos, retorna null (el master se mantiene en su estado actual).
 */
export function masterStageFromHouses(houses: HouseForStage[]): string | null {
  const active = houses.filter((h) => !TERMINAL_SET.has(h.stage_key));
  if (active.length === 0) return null;
  return active.reduce((behind, h) =>
    (STAGE_ORDER[h.stage_key] ?? 0) < (STAGE_ORDER[behind.stage_key] ?? 0) ? h : behind
  ).stage_key;
}

// Mapeo de event_codes Terminal49 → etapas estándar.
// Exportado para tests y para el adaptador de tracking.
export const TERMINAL49_STAGE_MAP: Readonly<Record<string, StageKey>> = {
  "container.pickup":    "picked_up",
  "vessel.departure":    "in_transit",
  "vessel.arrival":      "at_destination",
  "container.discharge": "at_destination",
  "container.delivery":  "delivered",
};

/**
 * Evalúa si un event_code implica sugerir avance de etapa.
 * Retorna la stage_key sugerida, o null si no aplica o si el master ya está en esa etapa o más adelante.
 */
export function shouldSuggestStage(
  eventCode: string,
  currentMasterStageKey: string
): StageKey | null {
  const suggested = TERMINAL49_STAGE_MAP[eventCode];
  if (!suggested) return null;
  const currentOrder = STAGE_ORDER[currentMasterStageKey] ?? 0;
  const suggestedOrder = STAGE_ORDER[suggested] ?? 0;
  if (suggestedOrder > currentOrder) return suggested;
  return null;
}

/**
 * Genera el mensaje para el evento shipment_events cuando cambia la ETA.
 * Visible al cliente.
 */
export function etaChangedMessage(oldEta: string | null, newEta: string): string {
  if (!oldEta) return `ETA establecida: ${newEta}`;
  return `ETA actualizada de ${oldEta} a ${newEta} por cambio en el master`;
}
