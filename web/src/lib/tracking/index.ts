// tracking/index.ts
// Fábrica de proveedores de tracking.
// Selecciona el proveedor según TRACKING_PROVIDER y las claves disponibles.
import "server-only";

import { env } from "@/lib/env";
import type { TrackingProvider } from "./provider";
import { ManualProvider } from "./manual";
import { Terminal49Provider } from "./terminal49";

export type { TrackingProvider, MasterForTracking, TrackingEvent } from "./provider";

export function getTrackingProvider(name?: string | null): TrackingProvider {
  const providerName = name ?? env.TRACKING_PROVIDER ?? "manual";

  if (providerName === "terminal49" && env.TERMINAL49_API_KEY && env.TERMINAL49_WEBHOOK_SECRET) {
    return new Terminal49Provider(
      env.TERMINAL49_API_KEY,
      env.TERMINAL49_WEBHOOK_SECRET
    );
  }

  return new ManualProvider();
}
