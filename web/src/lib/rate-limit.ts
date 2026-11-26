import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url:   process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// 5 intentos de login por IP cada 15 minutos.
export const loginLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "15 m"), prefix: "rl:login" })
  : null;

// 3 intentos de registro por IP cada hora.
export const signupLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 h"), prefix: "rl:signup" })
  : null;

// 5 invitaciones enviadas por tenant+IP cada hora.
export const inviteLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "1 h"), prefix: "rl:invite" })
  : null;

// 10 correos por usuario por hora (Fase F).
export const emailUserLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 h"), prefix: "rl:email:user" })
  : null;

// 50 correos por tenant por hora (Fase F).
export const emailTenantLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(50, "1 h"), prefix: "rl:email:tenant" })
  : null;

/** Verifica el límite. Devuelve true si puede continuar, false si debe bloquearse. */
export async function checkLimit(
  limiter: Ratelimit | null,
  key: string,
): Promise<boolean> {
  if (!limiter) return true; // Sin Redis configurado → pasa en desarrollo
  const { success } = await limiter.limit(key);
  return success;
}
