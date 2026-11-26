import "server-only";
import type { ErpExporter } from "./exporter";
import { CsvExporter }      from "./csv-exporter";
import { JsonExporter }     from "./json-exporter";
import { AdmCloudExporter } from "./adm-cloud-exporter";

export type ErpProvider = "csv" | "json" | "adm_cloud" | "none";

export function getErpExporter(
  provider: ErpProvider,
  credentials?: { apiKey: string; baseUrl: string }
): ErpExporter {
  switch (provider) {
    case "csv":
      return new CsvExporter();
    case "json":
      return new JsonExporter();
    case "adm_cloud":
      if (!credentials) {
        throw new Error("Se requieren credenciales para AdmCloudExporter");
      }
      return new AdmCloudExporter(credentials.apiKey, credentials.baseUrl);
    default:
      throw new Error(`Proveedor ERP desconocido: ${provider}`);
  }
}

export { CsvExporter }      from "./csv-exporter";
export { JsonExporter }     from "./json-exporter";
export { AdmCloudExporter } from "./adm-cloud-exporter";
export type { ErpExporter, PreInvoiceExport, ErpSendResult } from "./exporter";
