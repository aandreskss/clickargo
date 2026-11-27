import { round2 } from "./money";

export interface StayCalc {
  storedDays: number;
  billableDays: number;
  freeDaysRemaining: number;
  sellTotal: number;
}

/**
 * Calcula días almacenados, cobrables y total de venta para una estadía.
 * outDate = null significa que el embarque sigue almacenado → se usa la fecha actual.
 * Los días se calculan como diferencia de fechas en días completos (floor).
 */
export function calcStay(
  inDate: Date,
  outDate: Date | null,
  freeDays: number,
  sellRatePerDay: number,
): StayCalc {
  const ref = outDate ?? new Date();
  const inMs  = Date.UTC(inDate.getUTCFullYear(), inDate.getUTCMonth(), inDate.getUTCDate());
  const refMs = Date.UTC(ref.getUTCFullYear(),    ref.getUTCMonth(),    ref.getUTCDate());

  const storedDays       = Math.max(0, Math.floor((refMs - inMs) / 86_400_000));
  const billableDays     = Math.max(0, storedDays - freeDays);
  const freeDaysRemaining = freeDays - storedDays;
  const sellTotal        = round2(billableDays * sellRatePerDay);

  return { storedDays, billableDays, freeDaysRemaining, sellTotal };
}

/** Costo total de almacenaje según días cobrables y tarifa de costo. */
export function calcStayCost(billableDays: number, costRatePerDay: number): number {
  return round2(billableDays * costRatePerDay);
}
