// Lista canónica de subdominios reservados.
// Sincronizada con supabase/migrations/0005_invite_expiry_and_reserved_slugs.sql
// y con el set RESERVED en src/proxy.ts.
export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "mail", "status",
  "soporte", "support", "static", "assets", "cdn", "media",
  "blog", "docs", "help", "auth", "login", "registro",
  "monitoring", "health", "webhook", "webhooks", "ws",
  "socket", "realtime", "storage", "rpc", "rest", "graphql",
  "dashboard", "panel", "billing", "payment", "checkout",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
