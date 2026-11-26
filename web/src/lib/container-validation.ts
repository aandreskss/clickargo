// container-validation.ts
// Validación del formato ISO 6346 para números de contenedor.
// Lógica pura, sin dependencias externas.
//
// Formato: AAAU 999999 C
//   - 3 letras del propietario (owner code)
//   - 1 letra de categoría (U = unidad de carga, J = equipo detachable, Z = trailer)
//   - 6 dígitos seriales
//   - 1 dígito de control (check digit)
// Total: 11 caracteres (sin espacios ni guiones).

const ALPHABET_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

function charValue(c: string): number | null {
  if (c >= "0" && c <= "9") return parseInt(c, 10);
  return ALPHABET_VALUES[c] ?? null;
}

function computeCheckDigit(chars: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = charValue(chars[i]);
    if (v === null) return -1;
    sum += v * Math.pow(2, i);
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export type ValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string };

/**
 * Valida e normaliza un número de contenedor según ISO 6346.
 *
 * Comportamiento: si el formato es incorrecto, retorna valid:false con un
 * motivo en español. El llamador DEBE permitir guardar igualmente y mostrar
 * el motivo como advertencia — no como error bloqueante.
 */
export function validateISO6346(input: string): ValidationResult {
  if (!input || input.trim() === "") {
    return { valid: false, reason: "El número de contenedor está vacío." };
  }

  // Normalizar: mayúsculas, eliminar espacios y guiones
  const normalized = input.toUpperCase().replace(/[\s-]/g, "");

  if (normalized.length !== 11) {
    return {
      valid: false,
      reason: `El número debe tener 11 caracteres (tiene ${normalized.length}).`,
    };
  }

  // Primeras 3: letras del propietario
  for (let i = 0; i < 3; i++) {
    if (!/[A-Z]/.test(normalized[i])) {
      return {
        valid: false,
        reason: `Los primeros 3 caracteres deben ser letras (posición ${i + 1}: "${normalized[i]}").`,
      };
    }
  }

  // Posición 4: letra de categoría
  if (!/[A-Z]/.test(normalized[3])) {
    return {
      valid: false,
      reason: `El 4.° carácter (categoría) debe ser una letra ("${normalized[3]}").`,
    };
  }

  // Posiciones 5–10: 6 dígitos
  for (let i = 4; i < 10; i++) {
    if (!/[0-9]/.test(normalized[i])) {
      return {
        valid: false,
        reason: `Los caracteres 5 al 10 deben ser dígitos (posición ${i + 1}: "${normalized[i]}").`,
      };
    }
  }

  // Posición 11: dígito de control
  if (!/[0-9]/.test(normalized[10])) {
    return {
      valid: false,
      reason: `El dígito de control (posición 11) debe ser un número ("${normalized[10]}").`,
    };
  }

  const expected = computeCheckDigit(normalized.slice(0, 10));
  const actual = parseInt(normalized[10], 10);

  if (expected !== actual) {
    return {
      valid: false,
      reason: `Dígito de control incorrecto (esperado: ${expected}, recibido: ${actual}).`,
    };
  }

  return { valid: true, normalized };
}
