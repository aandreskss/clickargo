export const ITBIS_RATE = 0.18;

export type QuoteLine = {
  qty: number;
  unit_price: number;
  taxable: boolean;
};

export type QuoteTotals = {
  subtotal: number;
  itbis: number;
  total: number;
};

export type CostSummary = {
  total_cost: number;
  margin: number;
  margin_pct: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcLine(l: QuoteLine): { subtotal: number; itbis: number; total: number } {
  const sub = round2(l.qty * l.unit_price);
  const itbis = l.taxable ? round2(sub * ITBIS_RATE) : 0;
  return { subtotal: sub, itbis, total: round2(sub + itbis) };
}

export function calcTotals(lines: QuoteLine[]): QuoteTotals {
  const rows = lines.map(calcLine);
  const subtotal = round2(rows.reduce((s, r) => s + r.subtotal, 0));
  const itbis    = round2(rows.reduce((s, r) => s + r.itbis, 0));
  return { subtotal, itbis, total: round2(subtotal + itbis) };
}

export function calcMargin(total_sale: number, total_cost: number): CostSummary {
  const margin = round2(total_sale - total_cost);
  const margin_pct = total_sale > 0 ? round2((margin / total_sale) * 100) : 0;
  return { total_cost, margin, margin_pct };
}

export function fmtMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}
