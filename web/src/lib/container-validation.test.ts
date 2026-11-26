import { describe, it, expect } from "vitest";
import { validateISO6346 } from "./container-validation";

// MSCU1234565 es un número de prueba con check digit 5.
// Calculado: M=24,S=30,C=13,U=32 | 1,2,3,4,5,6 | check=5
// Sum = 24*1 + 30*2 + 13*4 + 32*8 + 1*16 + 2*32 + 3*64 + 4*128 + 5*256 + 6*512
//     = 24 + 60 + 52 + 256 + 16 + 64 + 192 + 512 + 1280 + 3072 = 5528
// 5528 % 11 = 5528 - 502*11 = 5528 - 5522 = 6  → check digit = 6 (no 5)
// Usaremos MSCU1234566 con check=6 o un número conocido válido.
// Número válido conocido: TGBU0019271 (check=1)
// TRLU0012345 → calculemos: T=31,R=29,L=23,U=32 | 0,0,1,2,3,4 | ...
// Para simplificar los tests usaremos verificación de estructura + check digit incorrecto.

describe("validateISO6346", () => {
  it("entrada vacía devuelve valid:false", () => {
    const r = validateISO6346("");
    expect(r.valid).toBe(false);
  });

  it("solo espacios devuelve valid:false", () => {
    const r = validateISO6346("   ");
    expect(r.valid).toBe(false);
  });

  it("longitud incorrecta devuelve valid:false con mensaje", () => {
    const r = validateISO6346("MSCU123");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/11 caracteres/);
  });

  it("minúsculas se normalizan antes de validar", () => {
    // mscu1234566 en minúsculas — si el check digit fuera correcto pasaría
    const upper = validateISO6346("MSCU1234566");
    const lower = validateISO6346("mscu1234566");
    // Ambos deberían retornar el mismo resultado (valid o invalid)
    expect(upper.valid).toBe(lower.valid);
  });

  it("espacios intermedios se eliminan antes de validar", () => {
    const withSpaces = validateISO6346("MSCU 123456 6");
    const withoutSpaces = validateISO6346("MSCU1234566");
    expect(withSpaces.valid).toBe(withoutSpaces.valid);
  });

  it("guiones se eliminan antes de validar", () => {
    const withDash = validateISO6346("MSCU-123456-6");
    const without = validateISO6346("MSCU1234566");
    expect(withDash.valid).toBe(without.valid);
  });

  it("dígito en lugar de letra de propietario devuelve valid:false", () => {
    const r = validateISO6346("1SCU1234566");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/letras/i);
  });

  it("letra en dígitos seriales devuelve valid:false", () => {
    const r = validateISO6346("MSCUA23456" + "6");
    expect(r.valid).toBe(false);
  });

  it("check digit incorrecto devuelve valid:false con mensaje descriptivo", () => {
    // Usar un número estructuralmente correcto pero con check digit equivocado
    // MSCU123456X → reemplazar X con un dígito incorrecto
    // Primero determinamos el dígito correcto para MSCU123456:
    // M=24, S=30, C=13, U=32, 1=1, 2=2, 3=3, 4=4, 5=5, 6=6
    // sum = 24*1 + 30*2 + 13*4 + 32*8 + 1*16 + 2*32 + 3*64 + 4*128 + 5*256 + 6*512
    //     = 24 + 60 + 52 + 256 + 16 + 64 + 192 + 512 + 1280 + 3072 = 5528
    // 5528 % 11 = 6 → check digit correcto es 6
    // Entonces MSCU1234566 debería ser válido y MSCU1234567 inválido
    const incorrect = validateISO6346("MSCU1234567");
    expect(incorrect.valid).toBe(false);
    if (!incorrect.valid) {
      // El mensaje menciona el dígito
    }
    if (!incorrect.valid) {
      expect(incorrect.reason).toMatch(/dígito de control/i);
    }
  });

  it("número MSCU1234566 con check digit 6 es válido", () => {
    // Basado en el cálculo anterior: check digit correcto = 6
    const r = validateISO6346("MSCU1234566");
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.normalized).toBe("MSCU1234566");
    }
  });

  it("número válido normalizado elimina espacios", () => {
    const r = validateISO6346("mscu 123456 6");
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.normalized).toBe("MSCU1234566");
    }
  });
});
