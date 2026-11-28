import { describe, it, expect, vi, afterEach } from "vitest";
import { calcStay, calcStayCost } from "./storage-math";

function d(iso: string) { return new Date(iso + "T00:00:00Z"); }

afterEach(() => vi.restoreAllMocks());

describe("calcStay", () => {
  it("estadía cerrada: 9 días almacenados, 0 libres → 9 cobrables", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-10"), 0, 10);
    expect(r.storedDays).toBe(9);
    expect(r.billableDays).toBe(9);
    expect(r.freeDaysRemaining).toBe(-9);
    expect(r.sellTotal).toBe(90);
  });

  it("días libres mayores que días almacenados → billableDays = 0, sellTotal = 0", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-05"), 10, 50);
    expect(r.storedDays).toBe(4);
    expect(r.billableDays).toBe(0);
    expect(r.freeDaysRemaining).toBe(6);
    expect(r.sellTotal).toBe(0);
  });

  it("días libres exactamente iguales a días almacenados → billableDays = 0", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-06"), 5, 100);
    expect(r.storedDays).toBe(5);
    expect(r.billableDays).toBe(0);
  });

  it("estadía abierta usa fecha de hoy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-11-11T12:00:00Z"));
    const r = calcStay(d("2024-11-01"), null, 0, 10);
    expect(r.storedDays).toBe(10);
    expect(r.sellTotal).toBe(100);
  });

  it("mismo día de entrada y salida → 0 días almacenados", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-01"), 5, 50);
    expect(r.storedDays).toBe(0);
    expect(r.billableDays).toBe(0);
    expect(r.sellTotal).toBe(0);
  });

  it("tarifa 0 → sellTotal = 0 aunque haya días cobrables", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-10"), 0, 0);
    expect(r.billableDays).toBe(9);
    expect(r.sellTotal).toBe(0);
  });

  it("redondea correctamente a 2 decimales", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-04"), 0, 3.33);
    expect(r.storedDays).toBe(3);
    expect(r.sellTotal).toBe(9.99);
  });
});

describe("calcStayCost", () => {
  it("días 0 → costo 0", () => {
    expect(calcStayCost(0, 100)).toBe(0);
  });

  it("calcula costo correctamente", () => {
    expect(calcStayCost(5, 20)).toBe(100);
  });

  it("redondea a 2 decimales", () => {
    expect(calcStayCost(3, 3.333)).toBe(10);
  });
});

describe("calcStay — billing_unit ft3 (Antillean)", () => {
  it("30 días libres, 100ft3, 0.50/ft3/día → 15 días cobrables, USD 750", () => {
    const r = calcStay(d("2024-11-01"), d("2025-01-15"), 30, 0.50, "ft3", 100);
    expect(r.storedDays).toBe(75);
    expect(r.billableDays).toBe(45);
    expect(r.billablePeriods).toBe(45);
    expect(r.sellTotal).toBe(2250);
  });

  it("Antillean benchmark del plan: 45 días almacenados, 30 libres, 100ft3, 0.50 → 750", () => {
    const r = calcStay(d("2024-11-01"), d("2024-12-16"), 30, 0.50, "ft3", 100);
    expect(r.storedDays).toBe(45);
    expect(r.billableDays).toBe(15);
    expect(r.billablePeriods).toBe(15);
    expect(r.sellTotal).toBe(750);
  });

  it("dentro de días libres → sellTotal = 0", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-20"), 30, 0.50, "ft3", 100);
    expect(r.billableDays).toBe(0);
    expect(r.sellTotal).toBe(0);
  });
});

describe("calcStay — billing_unit month", () => {
  it("31 días → 1 mes cobrable", () => {
    const r = calcStay(d("2024-11-01"), d("2024-12-02"), 0, 100, "month", 1);
    expect(r.storedDays).toBe(31);
    expect(r.billableDays).toBe(31);
    expect(r.billablePeriods).toBe(2);
    expect(r.sellTotal).toBe(200);
  });

  it("30 días exactos → 1 mes", () => {
    const r = calcStay(d("2024-11-01"), d("2024-12-01"), 0, 100, "month", 1);
    expect(r.billablePeriods).toBe(1);
    expect(r.sellTotal).toBe(100);
  });

  it("0 días cobrables → 0 meses → sellTotal 0", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-05"), 10, 100, "month", 1);
    expect(r.billableDays).toBe(0);
    expect(r.billablePeriods).toBe(0);
    expect(r.sellTotal).toBe(0);
  });
});

describe("calcStay — billing_unit pallet", () => {
  it("10 pallets, 2 meses, $5/pallet/mes → 100", () => {
    const r = calcStay(d("2024-11-01"), d("2025-01-01"), 0, 5, "pallet", 10);
    expect(r.storedDays).toBe(61);
    expect(r.billablePeriods).toBe(3); // ceil(61/30)=3
    expect(r.sellTotal).toBe(150);    // 3 * 10 * 5
  });
});

describe("calcStay — billing_unit day con qty > 1 (retrocompat.)", () => {
  it("day, qty=1 produce mismo resultado que antes", () => {
    const r = calcStay(d("2024-11-01"), d("2024-11-10"), 0, 10, "day", 1);
    expect(r.storedDays).toBe(9);
    expect(r.billableDays).toBe(9);
    expect(r.billablePeriods).toBe(9);
    expect(r.sellTotal).toBe(90);
  });
});
