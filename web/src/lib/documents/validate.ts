import "server-only";

export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME)[number];

export const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Firmas reales (magic bytes) por MIME type
// PDF: %PDF  |  JPEG: FFD8FF  |  PNG: 89504E47  |  WebP: RIFF????WEBP (bytes 0-3 y 8-11)
const MAGIC: Record<AllowedMime, { offset: number; bytes: number[] }[]> = {
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  "image/jpeg":      [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/png":       [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },   // RIFF
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },   // WEBP
  ],
};

function checkMagic(buf: Uint8Array, mime: AllowedMime): boolean {
  const checks = MAGIC[mime];
  return checks.every(({ offset, bytes }) =>
    bytes.every((b, i) => buf[offset + i] === b),
  );
}

export function validateDocumentFile(file: File): { ok: true } | { ok: false; code: "documento_tipo_invalido" | "documento_muy_grande" | "documento_firma_invalida" } {
  if (!ALLOWED_MIME.includes(file.type as AllowedMime)) {
    return { ok: false, code: "documento_tipo_invalido" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, code: "documento_muy_grande" };
  }
  return { ok: true };
}

export async function validateDocumentBytes(
  buf: Uint8Array,
  mime: string,
): Promise<{ ok: true } | { ok: false; code: "documento_tipo_invalido" | "documento_firma_invalida" }> {
  if (!ALLOWED_MIME.includes(mime as AllowedMime)) {
    return { ok: false, code: "documento_tipo_invalido" };
  }
  if (!checkMagic(buf, mime as AllowedMime)) {
    return { ok: false, code: "documento_firma_invalida" };
  }
  return { ok: true };
}
