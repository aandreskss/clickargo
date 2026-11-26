export type ChargeLine = {
  quantity: number;
  unit_price: number;
  tax_rate: number; // 0–1, e.g. 0.18
};

export type LineTotal = {
  subtotal: number;
  tax: number;
  total: number;
};

export type GroupTotals = {
  subtotal: number;
  tax: number;
  total: number;
};

export type MarginResult = {
  margin: number;
  margin_pct: number;
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcLineTotal(qty: number, unitPrice: number, taxRate: number): LineTotal {
  const subtotal = round2(qty * unitPrice);
  const tax = round2(subtotal * taxRate);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

export function calcGroupTotals(lines: ChargeLine[]): GroupTotals {
  const rows = lines.map((l) => calcLineTotal(l.quantity, l.unit_price, l.tax_rate));
  const subtotal = round2(rows.reduce((s, r) => s + r.subtotal, 0));
  const tax = round2(rows.reduce((s, r) => s + r.tax, 0));
  return { subtotal, tax, total: round2(subtotal + tax) };
}

export function calcMargin(venta: number, costo: number): MarginResult {
  const margin = round2(venta - costo);
  const margin_pct = venta > 0 ? round2((margin / venta) * 100) : 0;
  return { margin, margin_pct };
}

export function fmtMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}
