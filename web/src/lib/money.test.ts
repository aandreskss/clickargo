import { describe, it, expect } from "vitest";
import { round2, calcLineTotal, calcGroupTotals, calcMargin, fmtMoney } from "./money";

describe("round2", () => {
  it("redondea a 2 decimales", () => {
    expect(round2(1.455)).toBe(1.46);
    expect(round2(1.454)).toBe(1.45);
    expect(round2(100 / 3)).toBe(33.33);
  });
  it("no altera enteros", () => {
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
  });
});

describe("calcLineTotal", () => {
  it("cargo sin impuesto", () => {
    const r = calcLineTotal(2, 500, 0);
    expect(r).toEqual({ subtotal: 1000, tax: 0, total: 1000 });
  });
  it("cargo con ITBIS 18%", () => {
    const r = calcLineTotal(1, 100, 0.18);
    expect(r).toEqual({ subtotal: 100, tax: 18, total: 118 });
  });
  it("cargo por kg con tax_rate parcial", () => {
    const r = calcLineTotal(50, 1.5, 0.18); // 75 * 0.18 = 13.50
    expect(r.subtotal).toBe(75);
    expect(r.tax).toBe(13.50);
    expect(r.total).toBe(88.50);
  });
  it("precio cero retorna ceros", () => {
    const r = calcLineTotal(10, 0, 0.18);
    expect(r).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });
  it("cantidad decimal exacta", () => {
    // 2.5 contenedores a 1200 USD = 3000
    const r = calcLineTotal(2.5, 1200, 0);
    expect(r).toEqual({ subtotal: 3000, tax: 0, total: 3000 });
  });
});

describe("calcGroupTotals — 5 cargos mixtos", () => {
  const lines = [
    { quantity: 1,  unit_price: 500,  tax_rate: 0.18 },  // 500 + 90 = 590
    { quantity: 2,  unit_price: 200,  tax_rate: 0.18 },  // 400 + 72 = 472
    { quantity: 10, unit_price: 15,   tax_rate: 0 },     // 150 + 0 = 150
    { quantity: 1,  unit_price: 1000, tax_rate: 0.18 },  // 1000 + 180 = 1180
    { quantity: 5,  unit_price: 50,   tax_rate: 0 },     // 250 + 0 = 250
  ];
  // subtotal = 500+400+150+1000+250 = 2300
  // tax = 90+72+0+180+0 = 342
  // total = 2642

  it("calcula subtotal correcto", () => {
    expect(calcGroupTotals(lines).subtotal).toBe(2300);
  });
  it("calcula impuesto correcto", () => {
    expect(calcGroupTotals(lines).tax).toBe(342);
  });
  it("calcula total correcto", () => {
    expect(calcGroupTotals(lines).total).toBe(2642);
  });
  it("lista vacía retorna ceros", () => {
    expect(calcGroupTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });
});

describe("calcMargin", () => {
  it("margen positivo", () => {
    const r = calcMargin(2000, 1500);
    expect(r.margin).toBe(500);
    expect(r.margin_pct).toBe(25);
  });
  it("margen negativo", () => {
    const r = calcMargin(1000, 1200);
    expect(r.margin).toBe(-200);
    expect(r.margin_pct).toBe(-20);
  });
  it("venta cero retorna 0% margen", () => {
    const r = calcMargin(0, 500);
    expect(r.margin_pct).toBe(0);
  });
  it("margen 100% cuando costo es cero", () => {
    const r = calcMargin(500, 0);
    expect(r.margin).toBe(500);
    expect(r.margin_pct).toBe(100);
  });
});

describe("fmtMoney", () => {
  it("formatea USD", () => {
    // El formato exacto varía por Node; al menos debe incluir el monto
    expect(fmtMoney(1234.56, "USD")).toContain("1,234.56");
  });
  it("formatea DOP", () => {
    expect(fmtMoney(5000, "DOP")).toContain("5,000");
  });
});
