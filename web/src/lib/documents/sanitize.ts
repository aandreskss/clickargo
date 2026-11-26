import "server-only";
import { randomUUID } from "crypto";
import type { AllowedMime } from "./validate";

const MIME_TO_EXT: Record<AllowedMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg":      "jpg",
  "image/png":       "png",
  "image/webp":      "webp",
};

/** Genera un nombre de archivo seguro basado en el MIME type, nunca en el nombre original. */
export function safeFileName(mime: string): string {
  const ext = MIME_TO_EXT[mime as AllowedMime] ?? "bin";
  return `${randomUUID()}.${ext}`;
}

/** Construye el storage path para un documento de embarque. */
export function documentStoragePath(
  tenantId: string,
  shipmentId: string,
  fileName: string,
): string {
  return `${tenantId}/${shipmentId}/${fileName}`;
}
