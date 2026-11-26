import "server-only";
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { buildStyles } from "./theme";
import type { PreInvoicePdfData } from "./types";

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-DO", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function PreInvoicePdf({ data }: { data: PreInvoicePdfData }) {
  const S = buildStyles(data.template);
  const { tenant, template, pre_invoice: pi, account, lines } = data;

  return (
    <Document
      title={`Prefactura ${pi.number}`}
      author={tenant.name}
      creator="Clickargo SaaS"
    >
      <Page size="A4" style={S.page}>
        {/* Encabezado */}
        <View style={S.header}>
          {template.show_logo && tenant.logo_base64 && (
            <Image style={S.logo} src={tenant.logo_base64} />
          )}
          <View style={S.tenantInfo}>
            <Text style={S.tenantName}>{tenant.name}</Text>
            {tenant.tax_id && (
              <Text style={S.tenantMeta}>RNC: {tenant.tax_id}</Text>
            )}
            {tenant.address && (
              <Text style={S.tenantMeta}>{tenant.address}</Text>
            )}
            {tenant.contact_email && (
              <Text style={S.tenantMeta}>{tenant.contact_email}</Text>
            )}
          </View>
          <View>
            <Text style={S.docTitle}>PRE-FACTURA</Text>
            <Text style={S.docNumber}>{pi.number}</Text>
            <Text style={S.fieldLabel}>Fecha: {fmtDate(pi.created_at)}</Text>
            <Text style={S.fieldLabel}>Moneda: {pi.currency}</Text>
          </View>
        </View>

        {/* Datos del cliente */}
        <View style={S.section}>
          <Text style={S.sectionLabel}>Facturar a</Text>
          <Text style={S.fieldValueBold}>{account.name}</Text>
          {account.tax_id && (
            <Text style={S.fieldLabel}>RNC / ID: {account.tax_id}</Text>
          )}
          {account.email && (
            <Text style={S.fieldLabel}>{account.email}</Text>
          )}
        </View>

        <View style={S.divider} />

        {/* Tabla de líneas congeladas */}
        <Text style={S.sectionLabel}>Detalle de cargos</Text>
        <View style={S.table}>
          <View style={S.tableHeader}>
            <Text style={[S.tableHeaderCell, { flex: 3 }]}>Descripción</Text>
            <Text style={[S.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Cant.</Text>
            <Text style={[S.tableHeaderCell, { flex: 1 }]}>Unidad</Text>
            <Text style={[S.tableHeaderCell, { flex: 1.3, textAlign: "right" }]}>Precio</Text>
            <Text style={[S.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Imp.</Text>
            <Text style={[S.tableHeaderCell, { flex: 1.3, textAlign: "right" }]}>Total</Text>
          </View>
          {lines.map((line, i) => (
            <View key={i} style={[S.tableRow, i % 2 === 1 ? S.tableRowAlt : {}]}>
              <Text style={[S.tableCell, { flex: 3 }]}>{line.description}</Text>
              <Text style={[S.tableCellRight, { flex: 1 }]}>
                {Number(line.quantity).toLocaleString("es-DO")}
              </Text>
              <Text style={[S.tableCell, { flex: 1 }]}>{line.unit}</Text>
              <Text style={[S.tableCellRight, { flex: 1.3 }]}>
                {fmtMoney(line.unit_price, line.currency)}
              </Text>
              <Text style={[S.tableCellMuted, { flex: 1 }]}>
                {line.tax_rate > 0 ? fmtMoney(line.tax_amount, line.currency) : "—"}
              </Text>
              <Text style={[S.tableCellRight, { flex: 1.3 }]}>
                {fmtMoney(line.total, line.currency)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totales */}
        <View style={S.totalsBox}>
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>Subtotal</Text>
            <Text style={S.totalValue}>{fmtMoney(pi.subtotal, pi.currency)}</Text>
          </View>
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>ITBIS / Impuestos</Text>
            <Text style={S.totalValue}>{fmtMoney(pi.tax_total, pi.currency)}</Text>
          </View>
          <View style={S.totalBold}>
            <Text style={S.totalLabelBold}>Total</Text>
            <Text style={S.totalValueBold}>{fmtMoney(pi.total, pi.currency)}</Text>
          </View>
          {pi.exchange_rate && (
            <View style={[S.totalRow, { marginTop: 4 }]}>
              <Text style={S.totalLabel}>Tasa DOP/USD</Text>
              <Text style={S.totalValue}>{Number(pi.exchange_rate).toFixed(4)}</Text>
            </View>
          )}
        </View>

        {/* Notas */}
        {pi.notes && (
          <View style={[S.section, { marginTop: 16 }]}>
            <Text style={S.sectionLabel}>Notas</Text>
            <Text style={S.notes}>{pi.notes}</Text>
          </View>
        )}

        {/* Términos */}
        {template.terms_text && (
          <View style={[S.section, { marginTop: 8 }]}>
            <Text style={S.sectionLabel}>Términos de pago</Text>
            <Text style={S.notes}>{template.terms_text}</Text>
          </View>
        )}

        {/* Pie de página con disclaimer obligatorio */}
        <View style={S.footer}>
          <Text style={S.footerText}>
            {template.footer_text || `${tenant.name} · Generado con Clickargo`}
          </Text>
          <Text style={S.footerDisclaimer}>
            Este documento es una PRE-FACTURA. NO constituye un comprobante fiscal válido.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
