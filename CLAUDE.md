# Logística SaaS — contexto permanente

## Qué es
SaaS multi-tenant para agentes de carga (freight forwarders). Primer cliente: Box To Go (BOXTOGO RD,
logística y aduanas en República Dominicana). Después se licencia a otras navieras/agentes.
Referencia funcional: Linbis, pero más simple y 100% en español dominicano.
Alcance actual = SOLO lo que Box To Go usa hoy: cuentas, cotizaciones, embarques (mar import/export,
aire import), master/house, tracking por MBL, cargos y prefactura, documentos/PDF, almacenaje con
terceros, portal de seguimiento del cliente, reportes básicos.
FUERA de alcance (no construir ni dejar a medias): contabilidad, CxC/CxP, WMS, emisión de e-CF,
paquete de EE. UU. (ISF/AMS/AES), cobro de suscripciones, registro self-service de empresas.

## Stack (no cambiar sin pedir permiso)
Next.js 16 (App Router, Server Actions) + TypeScript estricto + Tailwind 4 + Supabase (Postgres, Auth,
Storage) + Vercel. PDF: @react-pdf/renderer. Correo: Resend. Errores: Sentry. Pruebas: Vitest + Playwright.
Rate limiting: @upstash/ratelimit + @upstash/redis. Anti-bot: Cloudflare Turnstile (stub listo en
src/lib/turnstile.ts, se activa con la variable de entorno).
IMPORTANTE: este Next.js tiene cambios incompatibles con lo que recuerdas. Antes de escribir código
lee la guía relevante en web/node_modules/next/dist/docs/. Ya sabemos: el archivo es src/proxy.ts (no
middleware.ts), params y searchParams son Promise, cacheComponents está en false.

## Estructura
- supabase/migrations/NNNN_nombre.sql  ← única forma de cambiar la base de datos
- supabase/tests/*.sql                 ← pruebas de aislamiento RLS y seguridad de BD
- web/src/proxy.ts                     ← subdominio → /t/<slug>/…, CSP con nonce, check AAL2
- web/src/app/t/[slug]/(app)/…       ← pantallas de cada empresa (tras login + membresía + MFA)
- web/src/app/t/[slug]/mfa-setup/     ← enrolamiento TOTP (fuera del grupo (app))
- web/src/app/t/[slug]/mfa-verify/    ← verificación TOTP (fuera del grupo (app))
- web/src/app/admin/…                 ← panel de superadmin (crear empresas)
- web/src/app/actions/…               ← Server Actions por módulo
- web/src/lib/env.ts                  ← valida variables de entorno al arrancar (server-only)
- web/src/lib/messages.ts             ← mapa de códigos de mensaje para URLs (?error=CODE)
- web/src/lib/rate-limit.ts           ← limitadores Upstash (server-only)
- web/src/lib/reserved-slugs.ts       ← lista canónica de subdominios reservados
- web/src/lib/permissions.ts          ← matriz roles/módulos/acciones, can(), ROLE_LABELS, ASSIGNABLE_ROLES
- web/src/lib/schemas/               ← esquemas Zod por módulo (team, settings, quotes…)
- web/src/lib/…                       ← lógica pura y testeable (sin React)
- web/src/components/ui.tsx           ← ÚNICA capa gráfica (ver "Diseño")
- web/src/components/port-select.tsx  ← autocomplete de puertos (client, recibe initialPorts del servidor)
- web/src/app/_design/page.tsx        ← galería de diseño (solo en development, retorna 404 en prod)
- scripts/check-bundle-secrets.mjs    ← busca secretos en el bundle (.next/static/chunks/)
- .github/workflows/ci.yml            ← CI: tsc, lint, test, audit, gitleaks, build, bundle-scan

## Multi-tenant: reglas que NUNCA se rompen
1. Toda tabla de negocio lleva tenant_id uuid not null references tenants(id) on delete cascade.
2. RLS activado en TODA tabla del esquema public, con políticas por membresía usando
   private.is_member(tenant_id) y private.has_role(tenant_id, roles[]). Nunca desactivar RLS.
3. tenant_id es inmutable (trigger private.lock_tenant_id) y se audita (trigger private.log_change).
4. Las funciones SECURITY DEFINER llevan set search_path = '' y validan membresía dentro.
5. Nunca usar la clave service_role en el navegador. Solo en código de servidor y solo si es
   imprescindible (webhooks); prefiere RPC con validación.
6. Los costos (lo que paga la empresa) viven en tablas separadas con política extra: solo
   memberships.can_see_costs = true. El portal del cliente jamás ve costos ni márgenes.
7. Cada tabla nueva trae su prueba de aislamiento entre empresas en supabase/tests/.
8. Archivos en Storage bajo /{tenant_id}/… con políticas por carpeta.
9. Los slugs reservados viven en public.reserved_slugs (migración 0005) y en src/lib/reserved-slugs.ts.
   Ambas fuentes deben estar sincronizadas.

## SEGURIDAD (prioridad máxima, por encima de cualquier otra)
- Si algo no se puede hacer de forma segura, NO se hace: avísame en lugar de simplificar la seguridad.
- Denegar por defecto, mínimo privilegio, nunca confiar en el cliente, fallar cerrado.
- SECRETOS: jamás en el repositorio, en el chat, en logs, en NEXT_PUBLIC_* ni en el navegador. Si ves o
  te piden pegar una clave, detente y avísame para rotarla. service_role/clave secreta solo en
  src/lib/supabase/admin.ts (server-only) y solo en las tareas listadas en docs/SEGURIDAD.md.
- ENTRADAS: todo dato externo es hostil. Valida con Zod en servidor (schemas en src/lib/schemas/).
  El tenant se deriva del host y la membresía, nunca de un campo del formulario. Las búsquedas de texto
  van por RPC parametrizada (search_accounts, search_quotes), nunca por .or() con texto del usuario.
- SQL: solo consultas parametrizadas; nada de concatenar texto del usuario. Funciones SECURITY DEFINER
  con search_path vacío y validación de membresía dentro.
- WEB: CSP dinámico con nonce (generado en proxy.ts, nonce en header x-nonce); HSTS, nosniff y
  frame-ancestors 'none' en next.config.ts; sin dangerouslySetInnerHTML (regla ESLint react/no-danger);
  redirecciones solo a lista blanca en auth.ts; mensajes en URL SOLO como códigos de src/lib/messages.ts.
- MENSAJES DE URL: usar siempre errUrl(base, 'code') y okUrl(base, 'code') de src/lib/messages.ts.
  Las páginas llaman decode(key) antes de pasar el valor a <Notice>. Nunca texto libre en ?error= ni ?ok=.
- ARCHIVOS: firma real, lista blanca, tamaño máximo, antivirus, bucket privado, URLs firmadas cortas.
- COSTOS: tablas separadas con política extra; el portal del cliente jamás ve costos ni notas internas.
- AUTENTICACIÓN: MFA TOTP obligatoria para owner, admin y superadmin (AAL2 verificado en
  (app)/layout.tsx y en proxy.ts para /admin). Registro solo por invitación (7 días de validez);
  segunda capa en private.hook_before_user_created (Auth Hook — configurar manualmente en Supabase).
  Rate limiting: 5 logins/15 min y 3 registros/hora por IP (src/lib/rate-limit.ts, Upstash Redis).
  Mínimo 12 caracteres de contraseña. Errores genéricos al usuario.
- AUDITORÍA: audit_log y security_events son append-only (triggers en migración 0009 lo fuerzan).
  Solo SECURITY DEFINER puede insertar en security_events. Ver tipos de evento en docs/SEGURIDAD.md.
- DEPENDENCIAS: no agregues paquetes sin justificarlo; revisa mantenimiento y vulnerabilidades; lockfile
  siempre; npm audit sin alta ni crítica (el CI falla si hay vulnerabilidades altas).
- FALLAS: ante un error se niega el acceso y se muestra un mensaje genérico en español; el detalle va
  solo al log del servidor.
- Cada fase termina con T1 (RLS) y T7 (intrusión) sin hallazgos críticos ni altos.

## Países
Lo común va en columnas; lo específico del país va en data jsonb definido en web/src/lib/field-packs.ts
(paquete DO implementado, US solo esqueleto). País de la empresa = tenants.country. No inventar
campos aduanales: si dudas, deja el campo opcional y márcalo en docs/PREGUNTAS_OPERACION.md.

## Diseño y UX (producto "100% user friendly")
- Todo en español dominicano claro. Cero jerga técnica en pantalla ("embarque", no "shipment").
- Cada pantalla responde: ¿dónde estoy?, ¿qué sigue?, ¿qué falta? El siguiente paso siempre visible.
- Crear embarque en 3 pasos y ~15 campos; autocompletar desde cliente, cotización y último embarque.
- Búsqueda global con Ctrl+K. Deshacer en vez de "¿estás seguro?" cuando sea posible.
- Estados vacíos que enseñan (qué es esto y qué hacer), errores que dicen cómo arreglarlos.
- Móvil primero: tablas que se vuelven tarjetas; botones táctiles de mínimo 44 px.
- Accesible: etiquetas en todo input, contraste AA, navegación por teclado, foco visible.
- SEPARACIÓN LÓGICA/GRÁFICO (obligatoria): las páginas NO llevan colores, tamaños ni sombras sueltos.
  Usan componentes de src/components/ui.tsx (Button, Field, Textarea, Select, Card, Table, Td, Tr,
  Badge, Notice, Tabs, EmptyState, PageHeader, Stepper, ConfirmUndo, CommandPalette…) y tokens
  semánticos de globals.css (--color-primary, --color-surface, --radius, --shadow-card, etc.).
  Cambiar el aspecto = tocar solo esa capa.
- ui.tsx lleva 'use client' (ConfirmUndo y CommandPalette usan hooks). Todos los componentes son
  presentacionales; ninguno llama APIs de servidor.

## Cómo trabajar
- Empieza en modo Plan: lee el repo, propón el plan, espera aprobación.
- Cambios pequeños y verificables. Después de cada bloque: npx tsc --noEmit y npm run build.
- Lógica de negocio pura en src/lib con pruebas Vitest. Flujos clave con Playwright.
- Mensajes de commit en español, imperativo, un tema por commit.
- Nunca inventes datos reales. El seed de demostración usa una empresa ficticia, no datos de Box To Go.
- Secretos solo en .env.local y variables de Vercel; jamás en el repo ni en el chat.
- No toques el proyecto Supabase de la web de Box To Go ni su dominio: este producto es independiente.
- Variables de entorno nuevas: documentar en web/.env.example Y en src/lib/env.ts (Zod schema).

## Progreso de fases

| Fase | Nombre | Estado | Notas |
|------|--------|--------|-------|
| A | Cimientos (tokens, equipo, ajustes, catálogos) | ✅ Completa | Migraciones 0001–0015 aplicadas; tests 07–09 pendientes de correr; bucket Storage pendiente |
| S | Seguridad (Auth, MFA, invitaciones, rate limit) | ✅ Código completo | Configuración manual Supabase/Redis/Turnstile pendiente |
| B | Cotizaciones (quotes, quote_lines, quote_line_costs) | ✅ Completa | Migración 0011 aplicada |
| C | Embarques | ✅ Completa | Migración 0016 aplicada; test 10 pasando; dashboard ¿Qué hago hoy? activo |
| D+E | Master / House BL + Tracking | ✅ Completa | Migración 0017 aplicada; test 11 listo; webhook Terminal49 con HMAC; cron diario; sugerencias en dashboard |
| E2 | Cargos, margen y prefactura | ✅ Completa | Migraciones 0018+0019 aplicadas; test 12 listo; ERP layer (CSV/JSON/ADM skeleton); AES-256-GCM credentials; tab Cargos en embarques; /prefacturas + /prefacturas/[id]; ajustes/integracion |
| F | PDF y correo (cotizaciones + embarques) | ✅ Completa | Migración 0020 aplicada (2026-11-26); test 13 listo; @react-pdf/renderer + Resend; API routes /api/documentos/*; docs/ subida Storage con magic bytes; ajustes/plantillas; FileDropZone con kindOptions; toggle visible_to_customer; proxy Content-Disposition en archivos/[id] |
| G | Almacenaje con terceros | ✅ Completa | repair_0018_0019 + 0021 aplicados (2026-11-26); test 14 PASS; storage_stays + storage_stay_costs (can_see_costs); calcStay() puro + 10 Vitest tests; 5 Server Actions idempotentes; tab Almacenaje en embarques/[id]; /almacenaje lista global; dashboard 2 tarjetas alerta |
| H | Portal cliente | ✅ Completa | Migraciones 0022_portal_enum + 0022_portal_role + 0023 aplicadas; test 15 listo; portal /portal + /portal-login + /portal-accept + /seguimiento/[token]; cron /api/cron/notifications (0 9 * * *); notificaciones en /ajustes/notificaciones; tracking link en embarques/[id]; sección portal en clientes/[id]; tsc PASS |
| I | Reportes básicos | — Siguiente — | — |

### Patrones establecidos (reutilizar en fases siguientes)
- Server Actions: `tenantFromHost()`, Zod, `errUrl/okUrl` → ver `src/app/actions/quotes.ts`
- Búsquedas: RPC SECURITY DEFINER con `private.is_member()` → ver `search_quotes`
- Costos internos: tabla separada (`quote_line_costs`) + política extra `can_see_costs` en memberships
- Lógica pura: `src/lib/quote-math.ts` + Vitest (patrón a seguir para cálculos de embarques)
- Serialización de líneas en formularios cliente: JSON en hidden input → `line_index` para mapear costos
- Estados expirados sin cron: calcular al momento de mostrar (patrón `effectiveStatus`)
- Numeración: RPC `next_number(_tenant, 'tabla', 'PREFIJO-')` → COT-000001, EMB-000001, etc.
- Equipo: RPC `list_team_members(_tenant)` SECURITY DEFINER que expone email (solo owner/admin);
  guarda "último owner" contando `role='owner' AND is_active=true` antes de degradar/desactivar;
  revocación de sesiones vía REST `POST /auth/v1/admin/users/{id}/logout` (scope global) desde admin.ts
- Roles y permisos: `src/lib/permissions.ts` → `can(role, module, action)` para guardianes en UI;
  RLS en BD es la fuente de verdad; permissions.ts es capa de presentación, nunca de seguridad
- Configuración del tenant: columnas sueltas en `tenants` para datos estructurados (logo_url, tax_id…);
  `tenants.settings` JSONB para configuración flexible (contadores, etc.)
- Storage: bucket privado `tenant-assets`; archivos bajo `{tenant_id}/branding/logo.{ext}`;
  validar firma real del archivo (bytes mágicos) antes de subir; generar URL firmada al mostrar
- Catálogos globales: tablas sin tenant_id (ports, incoterms, container_types); RLS con SELECT para
  authenticated, INSERT/UPDATE/DELETE revocado explícitamente; seed en la migración
- Autocomplete del servidor al cliente: el server component consulta los datos, los pasa como prop
  `initialPorts` al componente cliente; sin fetch adicional en el cliente → ver `port-select.tsx`
- Embarques — flujo de etapas: lógica pura en `src/lib/stage-rules.ts` (nextStage, canAdvance,
  canRollback, TERMINAL_STAGES); validación server-side en la action antes de UPDATE; event append-only
  en `shipment_events` (deny_mutation triggers); `advanceStage` re-fetch completo desde BD (nunca confiar en cliente)
- Embarques — wizard de 3 pasos: cada paso guarda en BD al avanzar (draft recovery automático);
  paso 2 maneja contenedores con JSON hidden input + ContainerEditor (client component con inputs nativos,
  no Field/Select de ui.tsx porque no reenvían onChange); ISO 6346 se valida pero no bloquea el guardado
- Embarques — edición directa: `src/app/actions/shipments.ts → updateShipment` combina los campos
  de paso 2 y paso 3 en una sola action; accesible desde `/embarques/[id]/editar` si no es terminal
- Tests RLS con superusuario: `SET LOCAL session_replication_role = 'replica'` para insertar FK falsas;
  `SET LOCAL ROLE authenticated` en bloque separado para que RLS aplique en el SELECT de verificación;
  `set_config('test.key', value, true)` para pasar valores entre bloques DO dentro de una transacción
- Migraciones con cambio de tipo de retorno: usar `DROP FUNCTION IF EXISTS` antes de `CREATE OR REPLACE`
  cuando los OUT parameters cambian (ej. 0015 agrega logo_url a tenant_by_slug)
- Masters — agrupación de houses: `shipments.master_id` FK hacia `masters`; etapa del master =
  la más atrasada de los houses activos (`private.recalc_master_stage`); sugerencias de avance en
  `masters.pending_suggestion_*` (nunca avance automático); `accept_tracking_suggestion` avanza todos
  los houses no-terminales y recalcula; `dismiss_tracking_suggestion` limpia sin avanzar
- Tracking — webhook seguro: leer body como texto antes de parsear JSON (para HMAC); verificar firma
  con `timingSafeEqual`; tolerancia ±5 min contra replay; rechazar >512 KB antes de leer body;
  payload raw guardado en `tracking_events.raw` sin interpretar URLs (anti-SSRF); INSERT via admin
  client (service_role) porque no hay sesión de usuario en webhook; `refresh_master_suggestion` solo
  callable por service_role (REVOKED de public/anon/authenticated)
- Tracking — idempotencia: UNIQUE(master_id, provider, event_code, occurred_at) + ON CONFLICT DO NOTHING
- Tracking — cron: `GET /api/cron/tracking` protegido con `Bearer CRON_SECRET`; Vercel cron en
  `vercel.json` con schedule `0 8 * * *`; polls masters con tracking_enabled + eta >= hoy + last_tracked_at stale
- Adaptadores de tracking: interfaz `TrackingProvider` en `src/lib/tracking/provider.ts`;
  `ManualProvider` (no-op); `Terminal49Provider` (HMAC-SHA256, poll GET /trackers, startTracking POST);
  `getTrackingProvider(name)` en `src/lib/tracking/index.ts` selecciona según env
- RPC search_masters: SECURITY DEFINER, no expone internal_notes; retorna type inline con alias en tsc
- Cargos de venta: `shipment_charges` + trigger `sc_lock_invoiced` bloquea edición cuando `pre_invoice_id IS NOT NULL`; costos en tabla separada `shipment_charge_costs` con RLS extra `can_see_costs`; vista `shipment_margin` con `security_invoker=true` filtra costos automáticamente según RLS del usuario
- Prefacturas inmutables: `pre_invoice_lines` con triggers `deny_mutation` (append-only); `shipment_charge_id` sin ON DELETE CASCADE (snapshot sobrevive al cargo original); trigger `pi_lock_financials` bloquea cambios financieros cuando status ≠ draft
- FK circular cargos↔prefacturas: igual que 0017 (masters↔tracking_events) — crear pre_invoices primero, luego ALTER TABLE ADD CONSTRAINT en shipment_charges
- Credenciales ERP: AES-256-GCM en `src/lib/erp/crypto.ts` (server-only); RLS solo expone masked_display, nunca encrypted_payload; guardado vía upsert en `integration_credentials`; masked_display generado con `maskSecret()` antes de guardar
- ERP exporter: interfaz `ErpExporter` en `src/lib/erp/exporter.ts`; `CsvExporter.toCsv()` neutraliza fórmulas (prefijo `'` si empieza con =,+,-,@,TAB,CR); factory `getErpExporter(provider)` selecciona según env ERP_PROVIDER; `AdmCloudExporter` es skeleton con TODO comentado pendiente de API docs de Box To Go
- Lógica monetaria: `src/lib/money.ts` → `round2` (Math.round × 100 / 100 evita IEEE 754), `calcLineTotal`, `calcGroupTotals`, `calcMargin`, `fmtMoney`; 17 Vitest tests en `money.test.ts`
- API export route: `GET /api/prefacturas/[id]/export?format=csv|json`; verifica sesión + membresía + rol antes de generar; registra en security_events; retorna como attachment con Content-Disposition
- PDFs on-demand: `@react-pdf/renderer` vía API routes server-side (nunca client); `renderToBuffer(React.createElement(Comp, props) as unknown as React.ReactElement<DocumentProps>)` + `new Response(new Uint8Array(buffer), {...})`; datos de branding en `src/lib/pdf/pdf-data.ts`; logo como data URL base64 (signed URL 30s → fetch → base64); plantillas configurables en `document_templates`
- Correo con Resend: cliente lazy-init en `src/lib/mail/resend.ts`; `sendWithPdfAttachment` en `src/lib/mail/send.ts` con rate limit (10/h usuario, 50/h tenant) + sanitización de subject (strip `\r\n`) + INSERT en `outbound_emails` (append-only); null-safe si `RESEND_API_KEY` no está configurada
- Documentos de embarque: validación magic bytes en `src/lib/documents/validate.ts`; nombre seguro UUID en `src/lib/documents/sanitize.ts`; signed URLs con anti path-traversal en `src/lib/documents/storage.ts`; `scan_status` column (pending/clean/quarantined) filtra en RLS
- Dialog component: en `ui.tsx`; Escape + click-fuera cierran; portal centrado con overlay; `open` guarda en state del componente padre
- SendEmailTrigger: `src/components/send-email-trigger.tsx`; abre Dialog con form email/asunto/cuerpo; native `<button form="...">` en footer (Button component no acepta prop `form`)
- FileDropZone: `src/components/file-drop-zone.tsx`; valida MIME + tamaño client-side; `formRef.current?.requestSubmit()` al seleccionar archivo; progressive enhancement (funciona sin drag)
- Almacenaje con terceros: `storage_stays` (estadías) + `storage_stay_costs` (1:1, can_see_costs); lógica pura en `src/lib/storage-math.ts` (`calcStay`, `calcStayCost`) con Vitest usando UTC methods (`getUTCFullYear/Month/Date`) para evitar bug de timezone; idempotencia via `charge_id` FK (ON DELETE SET NULL); `createChargeFromStay` server-side calcula con calcStay() antes de INSERT; Supabase nested joins tipados con `as unknown as T` para bypassear inferencia de arrays; constraints BD: `ss_out_after_in`, `ss_released_has_out`
- Portal del cliente: rol 'customer' en tenant_role enum; `private.is_member()` actualizado para excluir 'customer' (cascada automática a todas las políticas); helpers `private.is_staff()`, `private.is_customer()`, `private.customer_account_id()`; `tracking_links` (UNIQUE tenant_id+shipment_id, token = sha256 de 32 bytes aleatorios, raw nunca guardado); `notification_preferences` + `notification_queue` + trigger `enqueue_customer_notification`; RPC `get_tracking_shipment` SECURITY DEFINER accesible a anon; `portal_invitations` con token_hash UNIQUE
- Enum PostgreSQL: `ALTER TYPE ... ADD VALUE` debe ejecutarse en transacción separada antes de usar el nuevo valor (error 55P04); patrón: archivo `0022_portal_enum.sql` solo con ALTER TYPE, luego `0022_portal_role.sql` con el resto; hacer migraciones idempotentes con `IF NOT EXISTS` / `DROP IF EXISTS` para re-ejecución segura
- Routing sin subdominio (Vercel Hobby): `proxy.ts` detecta slug desde ruta `/t/{slug}/` cuando no hay subdominio; todas las acciones de auth y MFA reciben `base=/t/{slug}` via hidden input y construyen redirects con ese prefijo; links del layout usan `href={/t/${slug}/ruta}`; signOut también recibe `base` para redirigir al login correcto
- Primer usuario de un tenant: insertar invitación manualmente en `tenant_invites(tenant_id, email, role)` via SQL Editor; confirmar email via `UPDATE auth.users SET email_confirmed_at = now()`; resetear contraseña olvidada via `UPDATE auth.users SET encrypted_password = crypt('pass', gen_salt('bf'))`

## Definición de terminado (cada tarea)
Compila sin errores · lint sin errores · RLS probada · T1 y T7 sin hallazgos críticos ni altos ·
sin secretos en el repo (git grep) · node scripts/check-bundle-secrets.mjs sin hallazgos ·
estados vacío/carga/error cubiertos · funciona en móvil · textos en español · sin colores sueltos ·
mensajes de error como códigos (no texto libre) · criterios de aceptación del prompt demostrados.
