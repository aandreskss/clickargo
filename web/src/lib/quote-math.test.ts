import { describe, it, expect } from "vitest";
import { calcLine, calcTotals, calcMargin, ITBIS_RATE } from "./quote-math";

describe("calcLine", () => {
  it("línea no-taxable: sin ITBIS", () => {
    const r = calcLine({ qty: 1, unit_price: 100, taxable: false });
    expect(r).toEqual({ subtotal: 100, itbis: 0, total: 100 });
  });

  it("línea taxable: aplica ITBIS 18%", () => {
    const r = calcLine({ qty: 2, unit_price: 50, taxable: true });
    expect(r.subtotal).toBe(100);
    expect(r.itbis).toBe(18);
    expect(r.total).toBe(118);
  });

  it("precio cero es válido", () => {
    const r = calcLine({ qty: 1, unit_price: 0, taxable: true });
    expect(r).toEqual({ subtotal: 0, itbis: 0, total: 0 });
  });
});

describe("calcTotals", () => {
  it("líneas vacías → todo cero", () => {
    expect(calcTotals([])).toEqual({ subtotal: 0, itbis: 0, total: 0 });
  });

  it("una sola línea no-taxable", () => {
    const t = calcTotals([{ qty: 1, unit_price: 500, taxable: false }]);
    expect(t).toEqual({ subtotal: 500, itbis: 0, total: 500 });
  });

  it("una sola línea taxable", () => {
    const t = calcTotals([{ qty: 1, unit_price: 1000, taxable: true }]);
    expect(t.subtotal).toBe(1000);
    expect(t.itbis).toBe(1000 * ITBIS_RATE);
    expect(t.total).toBe(1180);
  });

  it("mixto: 1 taxable + 1 no-taxable", () => {
    const t = calcTotals([
      { qty: 1, unit_price: 200, taxable: true },
      { qty: 1, unit_price: 100, taxable: false },
    ]);
    expect(t.subtotal).toBe(300);
    expect(t.itbis).toBe(36);
    expect(t.total).toBe(336);
  });

  it("varias cantidades acumulan correctamente", () => {
    const t = calcTotals([
      { qty: 3, unit_price: 100, taxable: true },
      { qty: 2, unit_price: 50, taxable: true },
    ]);
    expect(t.subtotal).toBe(400);
    expect(t.itbis).toBe(72);
    expect(t.total).toBe(472);
  });

  it("sin artefactos de punto flotante", () => {
    const t = calcTotals([{ qty: 3, unit_price: 10.005, taxable: false }]);
    expect(t.subtotal).toBe(30.02);
    expect(t.total).toBe(30.02);
  });
});

describe("calcMargin", () => {
  it("margen positivo", () => {
    const r = calcMargin(118, 80);
    expect(r.total_cost).toBe(80);
    expect(r.margin).toBe(38);
    expect(r.margin_pct).toBe(32.2);
  });

  it("margen cero cuando costo = venta", () => {
    const r = calcMargin(100, 100);
    expect(r.margin).toBe(0);
    expect(r.margin_pct).toBe(0);
  });

  it("margen negativo (costo mayor que venta)", () => {
    const r = calcMargin(80, 100);
    expect(r.margin).toBe(-20);
    expect(r.margin_pct).toBeLessThan(0);
  });

  it("venta cero → margin_pct es 0 (no divide por cero)", () => {
    const r = calcMargin(0, 50);
    expect(r.margin_pct).toBe(0);
  });
});
