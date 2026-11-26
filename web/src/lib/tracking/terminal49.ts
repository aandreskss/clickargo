// tracking/terminal49.ts
// Adaptador Terminal49 (https://terminal49.com).
// Docs: https://www.terminal49.com/docs/api/
//
// Variables de entorno requeridas:
//   TERMINAL49_API_KEY            — clave de API (solo server-side)
//   TERMINAL49_WEBHOOK_SECRET     — secreto para verificar firmas HMAC
//
// ShipsGo está documentado como alternativa pendiente de implementar.

import { createHmac, timingSafeEqual } from "crypto";
import type { TrackingProvider, MasterForTracking, TrackingEvent } from "./provider";

const API_BASE = "https://api.terminal49.com/v2";

// Mapeo de event_types de Terminal49 → event_code normalizado.
// Los event_codes normalizados coinciden con los de TERMINAL49_STAGE_MAP en master-rules.ts.
export const T49_EVENT_CODE_MAP: Record<string, string> = {
  "container.pickup":               "container.pickup",
  "container.loaded_on_vessel":     "vessel.departure",
  "vessel.departure":               "vessel.departure",
  "vessel.arrival":                 "vessel.arrival",
  "container.discharged":           "container.discharge",
  "container.discharge":            "container.discharge",
  "container.out_for_delivery":     "container.delivery",
  "container.delivery":             "container.delivery",
  "container.delivered":            "container.delivery",
  "container.customs_release":      "container.customs_release",
  "container.customs_hold":         "container.customs_hold",
};

export class Terminal49Provider implements TrackingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string
  ) {}

  async startTracking(master: MasterForTracking): Promise<void> {
    const body = JSON.stringify({
      data: {
        type: "trackers",
        attributes: {
          request_number:      master.tracking_ref,
          request_number_type: master.mode === "ocean" ? "MBL" : "MAWB",
        },
      },
    });

    const res = await fetch(`${API_BASE}/trackers`, {
      method: "POST",
      headers: {
        Authorization:  `Token token="${this.apiKey}"`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok && res.status !== 422) {
      // 422 = ya existe un tracker para este número (idempotente)
      throw new Error(`Terminal49 startTracking: ${res.status} ${await res.text()}`);
    }
  }

  verifySignature(body: string, signature: string): boolean {
    const expected = createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex");
    const sigBuf = Buffer.from(signature.startsWith("sha256=") ? signature.slice(7) : signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  async parseWebhook(body: string, _headers: Record<string, string>): Promise<TrackingEvent[]> {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return [];
    }

    // Terminal49 envía un único evento por webhook.
    // Shape: { data: { type: "event", attributes: { event_type, occurred_at, location, ... } } }
    const data = (payload as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    if (!data || data.type !== "event") return [];

    const attrs = data.attributes as Record<string, unknown> | undefined;
    if (!attrs) return [];

    const rawEventType = String(attrs.event_type ?? "");
    const eventCode    = T49_EVENT_CODE_MAP[rawEventType] ?? rawEventType;
    const occurredRaw  = String(attrs.occurred_at ?? "");
    const occurredAt   = occurredRaw ? new Date(occurredRaw) : new Date();
    if (isNaN(occurredAt.getTime())) return [];

    return [{
      provider:    "terminal49",
      event_code:  eventCode,
      event_label: String(attrs.description ?? rawEventType),
      location:    attrs.location ? String(attrs.location) : undefined,
      occurred_at: occurredAt,
      raw:         payload,
    }];
  }

  async poll(master: MasterForTracking): Promise<TrackingEvent[]> {
    // GET /trackers?filter[request_number]=MBL&include=events
    const url = new URL(`${API_BASE}/trackers`);
    url.searchParams.set("filter[request_number]", master.tracking_ref);
    url.searchParams.set("include", "events");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Token token="${this.apiKey}"` },
    });

    if (!res.ok) {
      throw new Error(`Terminal49 poll: ${res.status} ${await res.text()}`);
    }

    const json = await res.json() as {
      included?: Array<{
        type: string;
        attributes: {
          event_type?: string;
          description?: string;
          occurred_at?: string;
          location?: string;
        };
      }>;
    };

    return (json.included ?? [])
      .filter((r) => r.type === "event")
      .map((r) => {
        const rawType = r.attributes.event_type ?? "";
        return {
          provider:    "terminal49",
          event_code:  T49_EVENT_CODE_MAP[rawType] ?? rawType,
          event_label: r.attributes.description ?? rawType,
          location:    r.attributes.location,
          occurred_at: new Date(r.attributes.occurred_at ?? Date.now()),
          raw:         r,
        } satisfies TrackingEvent;
      })
      .filter((e) => !isNaN(e.occurred_at.getTime()));
  }
}
