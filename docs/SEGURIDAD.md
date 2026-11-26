# Guía de seguridad

## Principios base
- Denegar por defecto, mínimo privilegio, nunca confiar en el cliente, fallar cerrado.
- Si algo no se puede hacer de forma segura, no se hace: se comunica antes de simplificar.
- Cada fase termina con una revisión de RLS (T1) y de intrusión (T7) sin hallazgos críticos ni altos.

---

## Multi-tenant y RLS

### Regla de oro
Toda tabla de negocio lleva `tenant_id uuid not null references tenants(id) on delete cascade` y RLS activado. Sin excepción.

### Helpers de RLS (esquema `private`)
| Función | Qué hace |
|---------|----------|
| `private.is_member(_tenant)` | Devuelve true si el usuario autenticado tiene membresía activa |
| `private.has_role(_tenant, _roles[])` | Devuelve true si el rol está en la lista |
| `private.is_superadmin()` | Devuelve true si el perfil tiene `is_superadmin = true` |

### `tenant_id` inmutable
El trigger `private.lock_tenant_id` impide mover filas entre empresas vía UPDATE. Nunca borrar ese trigger.

### Derivación del tenant
El tenant **siempre** se deriva del header `Host` de la petición (`src/lib/tenant.ts`), nunca de un campo del formulario. RLS contiene el daño si llegara un tenant manipulado, pero la derivación correcta es la primera línea de defensa.

---

## Funciones SECURITY DEFINER

Toda función con este modificador debe:
1. Declarar `set search_path = ''` para evitar inyección de esquema.
2. Validar membresía internamente antes de cualquier operación.
3. Estar documentada aquí si es de acceso público (`public.*`).

### Funciones públicas SECURITY DEFINER
| Función | Propósito | Quién puede llamarla |
|---------|-----------|----------------------|
| `public.tenant_by_slug(text)` | Resolver empresa desde subdominio | `anon`, `authenticated` |
| `public.next_number(uuid, text, text)` | Numeración atómica de documentos | `authenticated` (solo miembros) |
| `public.admin_create_tenant(text, text, char, text)` | Crear empresa nueva | `authenticated` (solo superadmin) |
| `public.search_accounts(uuid, text, text, int)` | Búsqueda parametrizada de cuentas | `authenticated` (solo miembros) |

### Funciones privadas SECURITY DEFINER
| Función | Propósito |
|---------|-----------|
| `private.handle_new_user()` | Crear perfil y asignar membresías al registrarse |
| `private.hook_before_user_created(jsonb)` | Bloquear registros sin invitación (Auth Hook) |
| `private.log_change()` | Auditoría genérica de INSERT/UPDATE/DELETE |
| `private.log_security_event()` | Registrar eventos sensibles en `security_events` |
| `private.lock_tenant_id()` | Impedir cambio de tenant_id |
| `private.touch_updated_at()` | Actualizar timestamp en UPDATE |
| `private.validate_tenant_slug()` | Rechazar slugs reservados en tenants |
| `private.cleanup_expired_invites()` | Eliminar invitaciones vencidas |

---

## Inventario de secretos

| Variable | Dónde vive | Uso | Quién la rota |
|----------|------------|-----|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local`, Vercel | URL del proyecto Supabase | Propietario del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env.local`, Vercel | Clave pública (antigua anon key) | Propietario del proyecto |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `.env.local`, Vercel | Dominio raíz del SaaS | Propietario del proyecto |
| `NEXT_PUBLIC_SENTRY_DSN` | `.env.local`, Vercel | DSN de Sentry para reportes de errores | Admin de Sentry |
| `SENTRY_AUTH_TOKEN` | Vercel (CI only) | Subida de source maps | Admin de Sentry |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `.env.local`, Vercel | Clave pública de Turnstile | Admin de Cloudflare |
| `TURNSTILE_SECRET_KEY` | `.env.local`, Vercel | Clave secreta de Turnstile (server-only) | Admin de Cloudflare |
| `UPSTASH_REDIS_REST_URL` | `.env.local`, Vercel | URL de Upstash Redis | Admin de Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | `.env.local`, Vercel | Token de Upstash Redis (server-only) | Admin de Upstash |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo Vercel server-side | Solo para los usos listados abajo | Propietario del proyecto |

### Regla de service_role
La clave `SUPABASE_SERVICE_ROLE_KEY` **solo puede** usarse en `src/lib/supabase/admin.ts`.

**Usos permitidos** (actualizar esta lista antes de añadir cualquier otro):
- *(ninguno todavía)*

**Prohibido:**
- Variables `NEXT_PUBLIC_*` para service_role.
- Importar `admin.ts` desde componentes, páginas o Server Actions de usuario.
- La regla ESLint `no-restricted-imports` refuerza esto automáticamente.

### Rotación de claves
Si una clave aparece accidentalmente en el repositorio, en logs o en el chat:
1. Rotarla inmediatamente en Supabase/Sentry antes de cualquier otra acción.
2. Verificar en `git log` que no quedó en ningún commit (usar `git filter-repo` si es necesario).
3. Registrar el incidente en `security_events` con `event_type = 'secret_exposed'`.

---

## Validación de entradas

- Todo dato externo se valida con **Zod en el servidor** antes de cualquier operación.
- Los schemas viven en `src/lib/schemas/`.
- El tenant se deriva del `Host`, nunca de un campo del formulario.
- Los IDs en URLs se validan como UUID antes de hacer queries (`/^[0-9a-f-]{36}$/i`).
- Los mensajes de error al cliente son **códigos** (`?error=CODE`), mapeados en `src/lib/messages.ts`. Nunca texto libre en URL.
- Los mensajes de error internos van solo al log del servidor.

---

## Redirecciones

Las redirecciones solo apuntan a URLs de la lista blanca definida en `src/app/actions/auth.ts`:
```ts
const ALLOWED_REDIRECTS = new Set(["/login", "/admin/login", "/"]);
```
Cualquier valor no incluido en la lista → redirige a `/login`.

---

## Headers HTTP

Configurados en `next.config.ts` para todas las rutas:

| Header | Valor |
|--------|-------|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | Dinámico con nonce (generado en `src/proxy.ts`): `script-src 'nonce-…' 'strict-dynamic'` |

El CSP es dinámico (nonce por petición) generado en `proxy.ts`. El nonce se inyecta como header `x-nonce` para que los layouts lo puedan leer.

---

## Tabla `security_events`

Tabla append-only para auditar acciones sensibles. Solo triggers y funciones `SECURITY DEFINER` pueden insertar. Los triggers `sec_events_no_update` y `sec_events_no_delete` bloquean modificaciones incluso a nivel de base de datos.

### Tipos de evento canónicos
| `event_type` | Cuándo registrar |
|--------------|-----------------|
| `login` | Login exitoso |
| `login_failed` | Login fallido (implementar con rate limiting) |
| `signup` | Registro de nuevo usuario |
| `role_changed` | Cambio de rol de un miembro |
| `can_see_costs_changed` | Cambio del flag de visibilidad de costos |
| `invite_created` | Invitación enviada |
| `invite_deleted` | Invitación cancelada |
| `tenant_created` | Nueva empresa creada por superadmin |
| `tenant_suspended` | Empresa suspendida |
| `secret_exposed` | Incidente de clave expuesta |
| `credential_accessed` | Credencial de integración leída (Fase F) |

**Regla:** nunca incluir secretos, contraseñas ni datos personales sensibles en `metadata`.

---

## Autenticación

- Registro solo por **invitación**: el usuario debe existir en `tenant_invites` con su correo y una invitación no vencida.
- Las invitaciones caducan a los **7 días**.
- La función `private.hook_before_user_created` actúa como segunda capa de verificación (Supabase Auth Hook — requiere configuración manual).
- **MFA obligatoria** para `owner`, `admin` y `superadmin` (TOTP, verificado como AAL2).
- **Rate limiting** en `signIn` (5 intentos/15 min por IP) y `signUp` (3 intentos/hora por IP) vía Upstash Redis.
- Errores de autenticación muestran mensajes genéricos al usuario.

---

## Archivos y Storage

- Bucket privado bajo `/{tenant_id}/…`.
- URLs firmadas con TTL corto (pendiente de implementar cuando se use Storage).
- Lista blanca de tipos MIME y tamaño máximo (pendiente).

---

## Procedimiento de incidente de seguridad

Ante un incidente (clave expuesta, acceso no autorizado, etc.):

1. **Aislar**: suspender el tenant afectado si aplica (cambiar `status = 'suspended'`).
2. **Revocar sesiones**: usar "Cerrar sesión en todos los dispositivos" (Fase F) o revocar directamente desde Supabase Auth.
3. **Rotar claves** en este orden:
   - Supabase: service_role, anon key
   - Cloudflare Turnstile: regenerar secret key
   - Upstash Redis: rotar token
   - Sentry: rotar auth token
4. **Verificar historial**: `git log` + `git grep` para confirmar que la clave no quedó en commits.
5. **Preservar registros**: NO borrar `security_events` ni `audit_log`.
6. **Avisar afectados**: notificar a usuarios afectados por correo con detalle mínimo.
7. **Post-mortem**: documentar qué pasó, cómo se detectó, cómo se corrigió y qué se cambió.

---

## Checklist de seguridad por fase

Antes de dar por terminada cualquier fase:
- [ ] `npx tsc --noEmit` sin errores.
- [ ] `npm run build` sin errores ni avisos.
- [ ] `npm run lint` sin errores (incluye `no-restricted-imports`).
- [ ] RLS probada: usuario de empresa A no puede ver/modificar datos de empresa B.
- [ ] Sin secretos en el repositorio (`git grep -i "service_role\|anon_key\|secret"`).
- [ ] Headers de seguridad presentes en las respuestas HTTP (incluye CSP con nonce).
- [ ] Mensajes de error al cliente son **códigos** (no texto libre).
- [ ] `supabase/tests/00_rls_completeness.sql` pasa sin errores.
- [ ] `node scripts/check-bundle-secrets.mjs` sin hallazgos.
