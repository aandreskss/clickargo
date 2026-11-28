import { round2 } from "./money";

export type BillingUnit = "day" | "ft3" | "month" | "pallet" | "m2";

export interface StayCalc {
  storedDays:         number;
  billableDays:       number;
  freeDaysRemaining:  number;
  /** billableDays for day/ft3; ceil(billableDays/30) for month/pallet/m2. */
  billablePeriods:    number;
  sellTotal:          number;
}

/**
 * Calcula días almacenados, cobrables y total de venta para una estadía.
 * outDate = null significa que el embarque sigue almacenado → se usa la fecha actual.
 *
 * Fórmulas por unidad:
 *   day / ft3  → billablePeriods = billableDays;   total = billablePeriods × qty × sellRate
 *   month / pallet / m2 → billablePeriods = ⌈billableDays / 30⌉; total = billablePeriods × qty × sellRate
 *
 * qty: unidades físicas (ft3, pallets, m2). Default = 1 (cobro por día simple).
 */
export function calcStay(
  inDate:      Date,
  outDate:     Date | null,
  freeDays:    number,
  sellRate:    number,
  billingUnit: BillingUnit = "day",
  qty:         number      = 1,
): StayCalc {
  const ref   = outDate ?? new Date();
  const inMs  = Date.UTC(inDate.getUTCFullYear(), inDate.getUTCMonth(), inDate.getUTCDate());
  const refMs = Date.UTC(ref.getUTCFullYear(),    ref.getUTCMonth(),    ref.getUTCDate());

  const storedDays        = Math.max(0, Math.floor((refMs - inMs) / 86_400_000));
  const billableDays      = Math.max(0, storedDays - freeDays);
  const freeDaysRemaining = freeDays - storedDays;

  const isMonthly     = billingUnit === "month" || billingUnit === "pallet" || billingUnit === "m2";
  const billablePeriods = isMonthly
    ? (billableDays > 0 ? Math.ceil(billableDays / 30) : 0)
    : billableDays;

  const sellTotal = round2(billablePeriods * qty * sellRate);

  return { storedDays, billableDays, freeDaysRemaining, billablePeriods, sellTotal };
}

/** Costo total de almacenaje según períodos cobrables y tarifa de costo. */
export function calcStayCost(billablePeriods: number, costRatePerPeriod: number): number {
  return round2(billablePeriods * costRatePerPeriod);
}
