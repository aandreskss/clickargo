import type { ErpExporter, PreInvoiceExport, ErpSendResult } from "./exporter";

export class JsonExporter implements ErpExporter {
  async send(pi: PreInvoiceExport): Promise<ErpSendResult> {
    return { ref: `JSON-${pi.number}-${Date.now()}` };
  }

  toJson(pi: PreInvoiceExport): string {
    // Solo incluye las columnas que operaciones necesita para ADM Cloud
    const payload = {
      prefactura: {
        numero:         pi.number,
        cliente:        pi.account_name,
        rnc:            pi.account_tax_id,
        moneda:         pi.currency,
        tasa_cambio:    pi.exchange_rate,
        fecha:          pi.created_at,
        notas:          pi.notes,
        subtotal:       pi.subtotal,
        impuesto:       pi.tax_total,
        total:          pi.total,
      },
      lineas: pi.lines.map((l) => ({
        codigo:         l.charge_type_code,
        descripcion:    l.description,
        cantidad:       l.quantity,
        unidad:         l.unit,
        precio_unitario: l.unit_price,
        moneda:         l.currency,
        tasa_impuesto:  l.tax_rate,
        subtotal:       l.subtotal,
        impuesto:       l.tax_amount,
        total:          l.total,
      })),
    };

    return JSON.stringify(payload, null, 2);
  }
}
