import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").split(":")[0];
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "status", "soporte", "support",
  "static", "assets", "cdn", "media", "blog", "docs", "help", "auth", "login", "registro",
  "monitoring", "health", "webhook", "webhooks", "ws", "socket", "realtime", "storage",
  "rpc", "rest", "graphql", "dashboard", "panel", "billing", "payment", "checkout"]);

/** Slug desde subdominio (boxtogo.dominio.com) o null si es el dominio raíz. */
function subdomainSlug(request: NextRequest): string | null {
  const hostname = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!hostname.endsWith(`.${ROOT}`)) return null;
  const slug = hostname.slice(0, -(ROOT.length + 1));
  return slug && !RESERVED.has(slug) ? slug : null;
}

/** Slug desde la ruta /t/{slug}/... cuando no hay subdominio (ej. clickargo.vercel.app). */
function pathSlug(pathname: string): string | null {
  const m = pathname.match(/^\/t\/([^/]+)/);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const slug = subdomainSlug(request);
  // Cuando no hay subdominio, el slug viene del path /t/{slug}/...
  const slugFromPath = !slug ? pathSlug(pathname) : null;

  // Generar nonce por petición para el CSP dinámico.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : "*.supabase.co";
  const csp = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.qrserver.com",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
    "font-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // Subdominio de empresa → reescribe a /t/<slug>/… e inyecta el nonce.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  const target = slug ? request.nextUrl.clone() : null;
  if (target && slug) target.pathname = `/t/${slug}${pathname === "/" ? "" : pathname}`;

  const { getResponse, user, currentLevel, nextLevel } = await updateSession(request, () => {
    const baseRes = target
      ? NextResponse.rewrite(target, { request: { headers: reqHeaders } })
      : NextResponse.next({ request: { headers: reqHeaders } });
    baseRes.headers.set("Content-Security-Policy", csp);
    return baseRes;
  });

  // Rutas protegidas
  if (!user) {
    // Rutas públicas de tenant (por subdominio o por path /t/{slug}/...)
    const tenantPublicPaths = ["/login", "/registro", "/portal-login", "/portal-accept"];
    const isTenantPublic = slug
      ? tenantPublicPaths.includes(pathname) || pathname.startsWith("/seguimiento/")
      : slugFromPath
        ? tenantPublicPaths.some(p => pathname === `/t/${slugFromPath}${p}`) ||
          pathname.startsWith(`/t/${slugFromPath}/seguimiento/`)
        : false;

    if (slug && !isTenantPublic) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (slugFromPath && !isTenantPublic) {
      return NextResponse.redirect(new URL(`/t/${slugFromPath}/login`, request.url));
    }
    if (!slug && !slugFromPath && pathname.startsWith("/admin") && pathname !== "/admin/login") {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // Admin requiere AAL2 (MFA verificado).
  const ADMIN_MFA_PAGES = ["/admin/login", "/admin/mfa-setup", "/admin/mfa-verify"];
  if (user && !slug && pathname.startsWith("/admin") && !ADMIN_MFA_PAGES.includes(pathname)) {
    if (currentLevel !== "aal2") {
      const dest = nextLevel === "aal2" ? "/admin/mfa-verify" : "/admin/mfa-setup";
      return NextResponse.redirect(new URL(dest, request.url));
    }
  }

  const response = getResponse();
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
