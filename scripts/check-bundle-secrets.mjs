#!/usr/bin/env node
// Busca patrones de secretos en el bundle generado por Next.js.
// Se ejecuta en CI después del build para asegurarse de que ninguna clave llegó al cliente.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CHUNKS_DIR = join(import.meta.dirname, "..", "web", ".next", "static", "chunks");

const PATTERNS = [
  { name: "service_role key",    re: /service_role/gi },
  { name: "Supabase secret key", re: /sb_secret_/gi },
  { name: "Stripe live key",     re: /sk_live_/gi },
  { name: "Stripe rk live",      re: /rk_live_/gi },
  { name: "JWT token largo",     re: /eyJ[A-Za-z0-9+/]{80,}/g },
  { name: "PEM private key",     re: /-----BEGIN (RSA )?PRIVATE KEY-----/g },
];

let found = false;

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      scanDir(fullPath);
      continue;
    }
    if (!entry.endsWith(".js")) continue;

    const content = readFileSync(fullPath, "utf8");
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(content)) {
        console.error(`[bundle-scan] ALERTA: patrón "${name}" encontrado en ${fullPath}`);
        found = true;
      }
    }
  }
}

if (statSync(CHUNKS_DIR, { throwIfNoEntry: false })) {
  scanDir(CHUNKS_DIR);
} else {
  console.error(`[bundle-scan] No se encontró el directorio: ${CHUNKS_DIR}`);
  console.error("[bundle-scan] ¿Olvidaste ejecutar npm run build primero?");
  process.exit(1);
}

if (found) {
  console.error("[bundle-scan] Falla: secretos detectados en el bundle del cliente.");
  process.exit(1);
} else {
  console.log("[bundle-scan] OK: no se encontraron secretos en el bundle.");
}
