import { describe, it, expect } from "vitest";
import {
  nextStage,
  requiredFieldsForStage,
  canAdvance,
  canRollback,
  isRollback,
  TERMINAL_STAGES,
  type StageKey,
} from "./stage-rules";

describe("nextStage", () => {
  it("draft -> booked", () => {
    expect(nextStage("draft")).toBe("booked");
  });

  it("booked -> picked_up", () => {
    expect(nextStage("booked")).toBe("picked_up");
  });

  it("delivered -> completed", () => {
    expect(nextStage("delivered")).toBe("completed");
  });

  it("completed -> null (terminal)", () => {
    expect(nextStage("completed")).toBeNull();
  });

  it("cancelled -> null (terminal)", () => {
    expect(nextStage("cancelled")).toBeNull();
  });
});

describe("TERMINAL_STAGES", () => {
  it("completed es terminal", () => {
    expect(TERMINAL_STAGES.has("completed")).toBe(true);
  });

  it("cancelled es terminal", () => {
    expect(TERMINAL_STAGES.has("cancelled")).toBe(true);
  });

  it("in_transit no es terminal", () => {
    expect(TERMINAL_STAGES.has("in_transit")).toBe(false);
  });
});

describe("requiredFieldsForStage", () => {
  it("draft no requiere nada", () => {
    expect(requiredFieldsForStage("draft")).toEqual([]);
  });

  it("booked requiere cuenta, modo, dirección y puertos", () => {
    const fields = requiredFieldsForStage("booked");
    expect(fields).toContain("account_id");
    expect(fields).toContain("mode");
    expect(fields).toContain("direction");
    expect(fields).toContain("origin_port_id");
    expect(fields).toContain("destination_port_id");
  });

  it("picked_up requiere naviera y booking", () => {
    const fields = requiredFieldsForStage("picked_up");
    expect(fields).toContain("carrier_account_id");
    expect(fields).toContain("booking_number");
  });

  it("at_origin requiere ETD", () => {
    expect(requiredFieldsForStage("at_origin")).toContain("etd");
  });

  it("at_destination requiere ETA", () => {
    expect(requiredFieldsForStage("at_destination")).toContain("eta");
  });

  it("delivered requiere ATA", () => {
    expect(requiredFieldsForStage("delivered")).toContain("ata");
  });

  it("cancelled no requiere nada", () => {
    expect(requiredFieldsForStage("cancelled")).toEqual([]);
  });
});

describe("canAdvance", () => {
  it("pasa a booked con todos los campos", () => {
    const result = canAdvance(
      {
        account_id: "uuid-1",
        mode: "ocean",
        direction: "import",
        origin_port_id: "DOPCM",
        destination_port_id: "USMIA",
      },
      "booked"
    );
    expect(result).toEqual({ ok: true });
  });

  it("falla a booked sin puertos", () => {
    const result = canAdvance(
      { account_id: "uuid-1", mode: "ocean", direction: "import" },
      "booked"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("origin_port_id");
      expect(result.missing).toContain("destination_port_id");
    }
  });

  it("falla a booked sin modo", () => {
    const result = canAdvance(
      {
        account_id: "uuid-1",
        direction: "import",
        origin_port_id: "DOPCM",
        destination_port_id: "USMIA",
      },
      "booked"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("mode");
    }
  });

  it("pasa a cancelled sin campos adicionales", () => {
    expect(canAdvance({}, "cancelled")).toEqual({ ok: true });
  });

  it("pasa a completed sin campos adicionales", () => {
    expect(canAdvance({}, "completed")).toEqual({ ok: true });
  });

  it("falla a delivered sin ATA", () => {
    const result = canAdvance({ etd: "2025-01-01", eta: "2025-01-15" }, "delivered");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("ata");
    }
  });

  it("null en campo se considera faltante", () => {
    const result = canAdvance({ account_id: null, mode: "ocean", direction: "import" }, "booked");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("account_id");
    }
  });
});

describe("canRollback", () => {
  it("owner puede hacer rollback", () => {
    expect(canRollback("owner")).toBe(true);
  });

  it("admin puede hacer rollback", () => {
    expect(canRollback("admin")).toBe(true);
  });

  it("manager puede hacer rollback", () => {
    expect(canRollback("manager")).toBe(true);
  });

  it("operator NO puede hacer rollback", () => {
    expect(canRollback("operator")).toBe(false);
  });

  it("viewer NO puede hacer rollback", () => {
    expect(canRollback("viewer")).toBe(false);
  });

  it("sales NO puede hacer rollback", () => {
    expect(canRollback("sales")).toBe(false);
  });
});

describe("isRollback", () => {
  it("booked -> draft es retroceso", () => {
    expect(isRollback("booked", "draft")).toBe(true);
  });

  it("draft -> booked NO es retroceso", () => {
    expect(isRollback("draft", "booked")).toBe(false);
  });

  it("cancelar desde cualquier etapa no es retroceso", () => {
    expect(isRollback("in_transit", "cancelled")).toBe(false);
    expect(isRollback("booked", "cancelled")).toBe(false);
  });

  it("in_transit -> at_origin es retroceso", () => {
    expect(isRollback("in_transit", "at_origin")).toBe(true);
  });
});
