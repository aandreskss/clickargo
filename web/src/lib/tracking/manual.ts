// tracking/manual.ts
// Adaptador manual: sin API externa. El usuario registra eventos desde la UI.
import type { TrackingProvider, MasterForTracking, TrackingEvent } from "./provider";

export class ManualProvider implements TrackingProvider {
  async startTracking(_master: MasterForTracking): Promise<void> {
    // No hay proveedor externo; nada que registrar.
  }

  verifySignature(_body: string, _signature: string): boolean {
    throw new Error("El modo manual no recibe webhooks");
  }

  async parseWebhook(_body: string, _headers: Record<string, string>): Promise<TrackingEvent[]> {
    throw new Error("El modo manual no recibe webhooks");
  }

  async poll(_master: MasterForTracking): Promise<TrackingEvent[]> {
    return [];
  }
}
