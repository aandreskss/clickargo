import type { ErpExporter, PreInvoiceExport, ErpSendResult } from "./exporter";

// Neutraliza fórmulas CSV: prefijo ' si la celda empieza con =, +, -, @, TAB, CR
function sanitizeCsvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str.replace(/"/g, '""')}`;
  }
  return str.replace(/"/g, '""');
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => `"${sanitizeCsvCell(c)}"`).join(",");
}

export class CsvExporter implements ErpExporter {
  async send(pi: PreInvoiceExport): Promise<ErpSendResult> {
    const rows: string[] = [];

    // Encabezado de la prefactura
    rows.push(csvRow(["Prefactura", pi.number]));
    rows.push(csvRow(["Cliente", pi.account_name]));
    rows.push(csvRow(["RNC/Tax ID", pi.account_tax_id]));
    rows.push(csvRow(["Moneda", pi.currency]));
    if (pi.exchange_rate) {
      rows.push(csvRow(["Tasa de cambio (DOP/USD)", pi.exchange_rate]));
    }
    rows.push(csvRow(["Fecha", pi.created_at]));
    if (pi.notes) rows.push(csvRow(["Notas", pi.notes]));
    rows.push(csvRow([]));

    // Encabezado de líneas
    rows.push(
      csvRow([
        "Código cargo",
        "Descripción",
        "Cantidad",
        "Unidad",
        "Precio unitario",
        "Moneda",
        "Tasa impuesto",
        "Subtotal",
        "Impuesto",
        "Total",
      ])
    );

    // Líneas
    for (const l of pi.lines) {
      rows.push(
        csvRow([
          l.charge_type_code,
          l.description,
          l.quantity,
          l.unit,
          l.unit_price,
          l.currency,
          l.tax_rate,
          l.subtotal,
          l.tax_amount,
          l.total,
        ])
      );
    }

    // Totales
    rows.push(csvRow([]));
    rows.push(csvRow(["", "", "", "", "", "", "Subtotal", "", "", pi.subtotal]));
    rows.push(csvRow(["", "", "", "", "", "", "Impuesto", "", "", pi.tax_total]));
    rows.push(csvRow(["", "", "", "", "", "", "TOTAL", "", "", pi.total]));

    return {
      ref: `CSV-${pi.number}-${Date.now()}`,
      // El llamador usa el contenido del csv vía toCsv()
    } as ErpSendResult & { csv: string };
  }

  toCsv(pi: PreInvoiceExport): string {
    const rows: string[] = [];

    rows.push(csvRow(["Prefactura", pi.number]));
    rows.push(csvRow(["Cliente", pi.account_name]));
    rows.push(csvRow(["RNC/Tax ID", pi.account_tax_id]));
    rows.push(csvRow(["Moneda", pi.currency]));
    if (pi.exchange_rate) {
      rows.push(csvRow(["Tasa de cambio (DOP/USD)", pi.exchange_rate]));
    }
    rows.push(csvRow(["Fecha", pi.created_at]));
    if (pi.notes) rows.push(csvRow(["Notas", pi.notes]));
    rows.push(csvRow([]));

    rows.push(
      csvRow([
        "Código cargo",
        "Descripción",
        "Cantidad",
        "Unidad",
        "Precio unitario",
        "Moneda",
        "Tasa impuesto",
        "Subtotal",
        "Impuesto",
        "Total",
      ])
    );

    for (const l of pi.lines) {
      rows.push(
        csvRow([
          l.charge_type_code,
          l.description,
          l.quantity,
          l.unit,
          l.unit_price,
          l.currency,
          l.tax_rate,
          l.subtotal,
          l.tax_amount,
          l.total,
        ])
      );
    }

    rows.push(csvRow([]));
    rows.push(csvRow(["", "", "", "", "", "", "Subtotal", "", "", pi.subtotal]));
    rows.push(csvRow(["", "", "", "", "", "", "Impuesto", "", "", pi.tax_total]));
    rows.push(csvRow(["", "", "", "", "", "", "TOTAL", "", "", pi.total]));

    return rows.join("\r\n");
  }
}
