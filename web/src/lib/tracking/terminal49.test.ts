import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { Terminal49Provider, T49_EVENT_CODE_MAP } from "./terminal49";

const provider = new Terminal49Provider("test-key", "test-secret");

describe("T49_EVENT_CODE_MAP", () => {
  it("mapea los eventos más comunes", () => {
    expect(T49_EVENT_CODE_MAP["vessel.departure"]).toBe("vessel.departure");
    expect(T49_EVENT_CODE_MAP["vessel.arrival"]).toBe("vessel.arrival");
    expect(T49_EVENT_CODE_MAP["container.discharged"]).toBe("container.discharge");
    expect(T49_EVENT_CODE_MAP["container.delivered"]).toBe("container.delivery");
  });
});

describe("Terminal49Provider.verifySignature", () => {
  const body = JSON.stringify({ data: { type: "event" } });

  it("acepta una firma válida", () => {
    const sig = createHmac("sha256", "test-secret").update(body).digest("hex");
    expect(provider.verifySignature(body, sig)).toBe(true);
  });

  it("acepta firma con prefijo sha256=", () => {
    const sig = "sha256=" + createHmac("sha256", "test-secret").update(body).digest("hex");
    expect(provider.verifySignature(body, sig)).toBe(true);
  });

  it("rechaza firma incorrecta", () => {
    expect(provider.verifySignature(body, "invalida")).toBe(false);
  });

  it("rechaza firma de longitud diferente", () => {
    expect(provider.verifySignature(body, "abc")).toBe(false);
  });
});

describe("Terminal49Provider.parseWebhook", () => {
  const makeBody = (event_type: string, occurred_at: string) =>
    JSON.stringify({
      data: {
        type: "event",
        attributes: {
          event_type,
          description: `Evento ${event_type}`,
          occurred_at,
          location: "PORT OF MIAMI",
        },
      },
    });

  it("parsea un evento vessel.arrival correctamente", async () => {
    const body = makeBody("vessel.arrival", "2025-03-15T10:00:00Z");
    const events = await provider.parseWebhook(body, {});
    expect(events).toHaveLength(1);
    expect(events[0].event_code).toBe("vessel.arrival");
    expect(events[0].location).toBe("PORT OF MIAMI");
    expect(events[0].provider).toBe("terminal49");
  });

  it("mapea container.delivered a container.delivery", async () => {
    const body = makeBody("container.delivered", "2025-03-20T14:00:00Z");
    const events = await provider.parseWebhook(body, {});
    expect(events[0].event_code).toBe("container.delivery");
  });

  it("retorna [] para payload sin formato esperado", async () => {
    expect(await provider.parseWebhook("{}", {})).toHaveLength(0);
    expect(await provider.parseWebhook("no-json", {})).toHaveLength(0);
    expect(
      await provider.parseWebhook(JSON.stringify({ data: { type: "other" } }), {})
    ).toHaveLength(0);
  });

  it("retorna [] si occurred_at es inválido", async () => {
    const body = makeBody("vessel.arrival", "not-a-date");
    expect(await provider.parseWebhook(body, {})).toHaveLength(0);
  });
});
