// tracking/provider.ts
// Interfaz y tipos compartidos para adaptadores de tracking.
// Sin dependencias externas — solo tipos puros.

export interface MasterForTracking {
  id: string;
  tenant_id: string;
  tracking_ref: string;         // MBL, MAWB o número de contenedor
  tracking_provider: string;    // 'terminal49' | 'manual'
  mode: "ocean" | "air";
}

export interface TrackingEvent {
  provider: string;
  event_code: string;
  event_label: string;
  location?: string;
  occurred_at: Date;
  raw: unknown;                 // payload original; jamás ejecutado
}

export interface TrackingProvider {
  /** Registra el tracking_ref en el proveedor (si aplica). */
  startTracking(master: MasterForTracking): Promise<void>;
  /** Verifica la firma HMAC del body del webhook. Lanza si no es soportado. */
  verifySignature(body: string, signature: string): boolean;
  /** Parsea el body del webhook y retorna los eventos normalizados. */
  parseWebhook(body: string, headers: Record<string, string>): Promise<TrackingEvent[]>;
  /** Consulta el proveedor y retorna los eventos más recientes. */
  poll(master: MasterForTracking): Promise<TrackingEvent[]>;
}
