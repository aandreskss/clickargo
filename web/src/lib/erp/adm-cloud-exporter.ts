import type { ErpExporter, PreInvoiceExport, ErpSendResult } from "./exporter";

// TODO (Fase F-ERP): Completar cuando se reciba documentación de la API de ADM Cloud.
//
// Pendiente de confirmar con Box To Go:
//   - URL base del endpoint (ej. https://api.admcloud.com/v1/facturas)
//   - Método de autenticación (Bearer token / API Key / OAuth2)
//   - Formato exacto del payload de creación de factura
//   - Campos requeridos y opcionales (tipo de comprobante, NCF, etc.)
//   - Respuesta: qué campo contiene el número de factura generado
//   - Manejo de reintentos y timeouts documentados por el proveedor
//   - Credenciales de sandbox para pruebas
//
// Las credenciales se guardan cifradas en integration_credentials.encrypted_payload
// (AES-256-GCM vía src/lib/erp/crypto.ts). Nunca se devuelven al navegador.

export class AdmCloudExporter implements ErpExporter {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async send(_preInvoice: PreInvoiceExport): Promise<ErpSendResult> {
    // TODO: implementar cuando tengamos:
    //   1. URL del endpoint confirmada
    //   2. Formato de autenticación (Header: Authorization: Bearer <key> ?)
    //   3. Mapping de campos prefactura → factura ADM Cloud
    //   4. Campo de respuesta que contiene el número de factura
    throw new Error(
      "AdmCloudExporter no implementado: aguardar documentación de API y credenciales de prueba de ADM Cloud"
    );
  }
}
