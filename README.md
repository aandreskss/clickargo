# Logística SaaS (multi-tenant)

- `supabase/migrations/` — esquema (0001 núcleo, 0002 invitaciones). Ya aplicado en el proyecto `logistica-saas`.
- `web/` — Next.js 16 + Tailwind. El subdominio decide la empresa (`src/proxy.ts`).

## Correr en local
```bash
cd web && cp .env.example .env.local   # pega la clave publicable de Supabase
npm install && npm run dev
```
- Admin: http://localhost:3000/admin
- Empresa: http://miempresa.localhost:3000  (Chrome resuelve *.localhost solo)

## Primer superadmin
1. Regístrate (cualquier empresa de prueba o crea tu usuario en Supabase → Authentication).
2. En el SQL Editor: `update public.profiles set is_superadmin = true where id = (select id from auth.users where email = 'TU_CORREO');`
