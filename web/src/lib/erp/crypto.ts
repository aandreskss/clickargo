import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM. ENCRYPTION_KEY debe ser un string base64 de exactamente 32 bytes.
// Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

function getKey(): Buffer {
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!keyB64) throw new Error("ENCRYPTION_KEY no configurada");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe decodificar a exactamente 32 bytes");
  }
  return key;
}

export type EncryptResult = {
  payload: string;  // ciphertext en base64
  iv:      string;  // nonce en base64 (12 bytes)
  authTag: string;  // GCM auth tag en base64 (16 bytes)
};

export function encrypt(plaintext: string): EncryptResult {
  const key    = getKey();
  const iv     = randomBytes(12); // 96 bits para AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    payload: encrypted.toString("base64"),
    iv:      iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(payload: string, iv: string, authTag: string): string {
  const key      = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  const visible = plaintext.slice(-4);
  return `${"•".repeat(Math.min(8, plaintext.length - 4))}${visible}`;
}
