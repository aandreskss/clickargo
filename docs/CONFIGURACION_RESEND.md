# Configuración de correo con Resend

## Crear cuenta y obtener API key

1. Crear cuenta en resend.com
2. En el panel, ir a **API Keys** → **Create API Key**
3. Nombre sugerido: `clickargo-produccion`
4. Copiar la clave (empieza con `re_`)
5. Agregar al entorno:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   RESEND_FROM_EMAIL=notificaciones@tudominio.com
   RESEND_FROM_NAME=Box To Go
   ```

## Verificar dominio (obligatorio para envío en producción)

Sin verificación de dominio, Resend solo envía a cuentas verificadas manualmente.

### 1. Agregar el dominio en Resend

1. En Resend → **Domains** → **Add Domain**
2. Ingresar tu dominio (ej: `boxtogo.com`)
3. Resend mostrará los registros DNS a agregar

### 2. Configurar registros DNS

Agregar en el proveedor DNS del dominio:

**SPF** (evita que el correo sea marcado como spam):
```
TXT  @   "v=spf1 include:amazonses.com ~all"
```

**DKIM** (firma criptográfica — el valor exacto lo proporciona Resend):
```
CNAME  resend._domainkey   <valor-que-da-resend>.dkim.amazonses.com
```

**DMARC** (política de validación):
```
TXT  _dmarc   "v=DMARC1; p=quarantine; rua=mailto:dmarc@tudominio.com"
```

### 3. Verificar en Resend

Después de propagar los DNS (puede tardar hasta 48 h), hacer clic en **Verify** en el panel de Resend.

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `RESEND_API_KEY` | Clave de API de Resend | `re_abc123...` |
| `RESEND_FROM_EMAIL` | Dirección de envío verificada | `noti@boxtogo.com` |
| `RESEND_FROM_NAME` | Nombre del remitente | `Box To Go` |

## Comportamiento sin configurar

Si `RESEND_API_KEY` no está configurada, el botón "Enviar por correo" muestra el mensaje:
> "Configura el correo de envío en Ajustes → Integración."

No hay crash ni error silencioso.

## Límites de envío

La aplicación aplica rate limiting automático:
- **10 correos por usuario por hora**
- **50 correos por tenant por hora**

Estos límites requieren Redis (Upstash) configurado. Sin Redis, no hay límite.
