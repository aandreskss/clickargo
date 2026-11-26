import type { NextConfig } from "next";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

const nextConfig: NextConfig = {
  // App 100% autenticada y dinámica: sin Cache Components por ahora.
  cacheComponents: false,
  partialPrefetching: false,
  experimental: {
    serverActions: {
      // Permite Server Actions desde el dominio raíz y todos los subdominios de tenant.
      allowedOrigins: [
        "localhost:3000",
        ...(ROOT !== "localhost:3000"
          ? [ROOT, `*.${ROOT}`]
          : []),
      ],
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          // HSTS: 2 años, incluye subdominios (multi-tenant los necesita).
          { key: "Strict-Transport-Security",  value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=()" },
          // CSP con nonce se genera en proxy.ts por petición.
          // Aquí solo queda el fallback estático para rutas que el proxy no intercepte.
          { key: "Content-Security-Policy",
            value: "default-src 'self'; frame-ancestors 'none'; object-src 'none';" },
        ],
      },
    ];
  },
};

export default nextConfig;
