import "server-only";
import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL:            z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_ROOT_DOMAIN:             z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN:              z.string().url().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:      z.string().optional(),
});

const serverSchema = z.object({
  UPSTASH_REDIS_REST_URL:    z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN:  z.string().optional(),
  TURNSTILE_SECRET_KEY:      z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Tracking
  TRACKING_PROVIDER:         z.enum(["terminal49", "manual"]).optional(),
  TERMINAL49_API_KEY:        z.string().optional(),
  TERMINAL49_WEBHOOK_SECRET: z.string().optional(),
  // Cron
  CRON_SECRET:               z.string().min(32).optional(),
  // ERP (Fase E)
  ENCRYPTION_KEY:            z.string().min(44).optional(), // base64 de 32 bytes; generar con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ERP_PROVIDER:              z.enum(["adm_cloud", "csv", "json", "none"]).optional().default("none"),
  // Correo (Fase F)
  RESEND_API_KEY:            z.string().optional(),
  RESEND_FROM_EMAIL:         z.string().email().optional(),
  RESEND_FROM_NAME:          z.string().optional(),
});

function build() {
  const isTest = process.env.NODE_ENV === "test";
  const pub = publicSchema.safeParse(process.env);
  const srv = serverSchema.safeParse(process.env);

  const errors: string[] = [];
  if (!pub.success && !isTest) {
    errors.push(...pub.error.issues.map((i) => `  ${String(i.path[0])}: ${i.message}`));
  }
  if (!srv.success && !isTest) {
    errors.push(...srv.error.issues.map((i) => `  ${String(i.path[0])}: ${i.message}`));
  }
  if (errors.length > 0) {
    throw new Error(`Variables de entorno inválidas:\n${errors.join("\n")}`);
  }

  return { ...(pub.data ?? {}), ...(srv.data ?? {}) } as z.infer<typeof publicSchema> &
    z.infer<typeof serverSchema>;
}

export const env = build();

export const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL:            env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_ROOT_DOMAIN:             env.NEXT_PUBLIC_ROOT_DOMAIN,
  NEXT_PUBLIC_SENTRY_DSN:              env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:      env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
};
