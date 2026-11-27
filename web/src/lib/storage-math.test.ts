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
