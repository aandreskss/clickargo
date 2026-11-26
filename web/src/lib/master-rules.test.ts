import { describe, it, expect } from "vitest";
import {
  masterStageFromHouses,
  shouldSuggestStage,
  etaChangedMessage,
  TERMINAL49_STAGE_MAP,
} from "./master-rules";

describe("masterStageFromHouses", () => {
  it("retorna null si no hay houses activos", () => {
    expect(masterStageFromHouses([])).toBeNull();
    expect(masterStageFromHouses([{ stage_key: "completed" }, { stage_key: "cancelled" }])).toBeNull();
  });

  it("retorna la etapa del único house activo", () => {
    expect(masterStageFromHouses([{ stage_key: "in_transit" }])).toBe("in_transit");
  });

  it("retorna la más atrasada entre varios houses", () => {
    const houses = [
      { stage_key: "at_destination" },
      { stage_key: "in_transit" },
      { stage_key: "booked" },
    ];
    expect(masterStageFromHouses(houses)).toBe("booked");
  });

  it("ignora houses terminales al calcular la más atrasada", () => {
    const houses = [
      { stage_key: "delivered" },
      { stage_key: "cancelled" },
      { stage_key: "completed" },
    ];
    expect(masterStageFromHouses(houses)).toBe("delivered");
  });

  it("todos iguales → retorna esa etapa", () => {
    const houses = [
      { stage_key: "in_transit" },
      { stage_key: "in_transit" },
    ];
    expect(masterStageFromHouses(houses)).toBe("in_transit");
  });
});

describe("shouldSuggestStage", () => {
  it("retorna null para event_code desconocido", () => {
    expect(shouldSuggestStage("unknown.event", "in_transit")).toBeNull();
  });

  it("retorna la etapa sugerida si el master está por detrás", () => {
    expect(shouldSuggestStage("vessel.arrival", "in_transit")).toBe("at_destination");
    expect(shouldSuggestStage("container.delivery", "at_destination")).toBe("delivered");
  });

  it("retorna null si el master ya está en esa etapa o más adelante", () => {
    expect(shouldSuggestStage("vessel.arrival", "at_destination")).toBeNull();
    expect(shouldSuggestStage("vessel.arrival", "delivered")).toBeNull();
  });
});

describe("etaChangedMessage", () => {
  it("mensaje cuando no había ETA previa", () => {
    expect(etaChangedMessage(null, "2025-03-15")).toBe("ETA establecida: 2025-03-15");
  });

  it("mensaje cuando cambia de ETA existente", () => {
    expect(etaChangedMessage("2025-03-10", "2025-03-15")).toBe(
      "ETA actualizada de 2025-03-10 a 2025-03-15 por cambio en el master"
    );
  });
});

describe("TERMINAL49_STAGE_MAP", () => {
  it("cubre los event_codes principales de Terminal49", () => {
    expect(TERMINAL49_STAGE_MAP["container.pickup"]).toBe("picked_up");
    expect(TERMINAL49_STAGE_MAP["vessel.departure"]).toBe("in_transit");
    expect(TERMINAL49_STAGE_MAP["vessel.arrival"]).toBe("at_destination");
    expect(TERMINAL49_STAGE_MAP["container.discharge"]).toBe("at_destination");
    expect(TERMINAL49_STAGE_MAP["container.delivery"]).toBe("delivered");
  });
});
