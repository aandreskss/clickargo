import "server-only";
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { buildStyles } from "./theme";
import type { QuotePdfData } from "./types";

const SERVICE_LABELS: Record<string, string> = {
  mar_import: "Importación marítima",
  mar_export: "Exportación marítima",
  aire_import: "Importación aérea",
};

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-DO", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function QuotePdf({ data }: { data: QuotePdfData }) {
  const S = buildStyles(data.template);
  const { tenant, template, quote, account, lines, totals } = data;
  const isDraft = quote.status === "draft";

  return (
    <Document
      title={`Cotización ${quote.number}`}
      author={tenant.name}
      creator="Clickargo SaaS"
    >
      <Page size="A4" style={S.page}>
        {/* Marca de agua BORRADOR */}
        {isDraft && <Text style={S.watermark}>BORRADOR</Text>}

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
            <Text style={S.docTitle}>COTIZACIÓN</Text>
            <Text style={S.docNumber}>{quote.number}</Text>
            <Text style={S.fieldLabel}>Fecha: {fmtDate(quote.created_at)}</Text>
            {quote.valid_until && (
              <Text style={S.fieldLabel}>Válida hasta: {fmtDate(quote.valid_until)}</Text>
            )}
          </View>
        </View>

        {/* Datos del cliente y del servicio */}
        <View style={[S.section, S.row2]}>
          <View style={S.col}>
            <Text style={S.sectionLabel}>Cliente</Text>
            <Text style={S.fieldValueBold}>{account.name}</Text>
            {account.tax_id && (
              <Text style={S.fieldLabel}>RNC / ID: {account.tax_id}</Text>
            )}
            {account.contact_name && (
              <Text style={S.fieldLabel}>Attn: {account.contact_name}</Text>
            )}
            {account.email && (
              <Text style={S.fieldLabel}>{account.email}</Text>
            )}
          </View>
          <View style={S.col}>
            <Text style={S.sectionLabel}>Servicio</Text>
            <Text style={S.fieldValue}>
              {SERVICE_LABELS[quote.service_type] ?? quote.service_type}
            </Text>
            {(quote.origin || quote.destination) && (
              <Text style={S.fieldLabel}>
                {[quote.origin, quote.destination].filter(Boolean).join(" → ")}
              </Text>
            )}
          </View>
        </View>

        <View style={S.divider} />

        {/* Tabla de líneas — SIN costos ni margen */}
        <Text style={S.sectionLabel}>Líneas de servicio</Text>
        <View style={S.table}>
          <View style={S.tableHeader}>
            <Text style={[S.tableHeaderCell, S.colDesc]}>Descripción</Text>
            <Text style={[S.tableHeaderCell, S.colNum, { textAlign: "right" }]}>Cant.</Text>
            <Text style={[S.tableHeaderCell, S.colMoney, { textAlign: "right" }]}>Precio</Text>
            <Text style={[S.tableHeaderCell, S.colMoney, { textAlign: "right" }]}>ITBIS</Text>
            <Text style={[S.tableHeaderCell, S.colMoney, { textAlign: "right" }]}>Total</Text>
          </View>
          {lines.map((line, i) => {
            const sub = line.qty * line.unit_price;
            const itbis = line.taxable ? sub * 0.18 : 0;
            const lineTotal = sub + itbis;
            return (
              <View key={i} style={[S.tableRow, i % 2 === 1 ? S.tableRowAlt : {}]}>
                <Text style={[S.tableCell, S.colDesc]}>{line.service}</Text>
                <Text style={[S.tableCellRight, S.colNum]}>
                  {Number(line.qty).toLocaleString("es-DO")}
                </Text>
                <Text style={[S.tableCellRight, S.colMoney]}>
                  {fmtMoney(line.unit_price, line.currency)}
                </Text>
                <Text style={[S.tableCellMuted, S.colMoney]}>
                  {line.taxable ? fmtMoney(itbis, line.currency) : "—"}
                </Text>
                <Text style={[S.tableCellRight, S.colMoney]}>
                  {fmtMoney(lineTotal, line.currency)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Totales */}
        <View style={S.totalsBox}>
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>Subtotal</Text>
            <Text style={S.totalValue}>{fmtMoney(totals.subtotal, quote.currency)}</Text>
          </View>
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>ITBIS (18%)</Text>
            <Text style={S.totalValue}>{fmtMoney(totals.itbis, quote.currency)}</Text>
          </View>
          <View style={S.totalBold}>
            <Text style={S.totalLabelBold}>Total</Text>
            <Text style={S.totalValueBold}>{fmtMoney(totals.total, quote.currency)}</Text>
          </View>
        </View>

        {/* Notas */}
        {quote.notes && (
          <View style={[S.section, { marginTop: 16 }]}>
            <Text style={S.sectionLabel}>Notas</Text>
            <Text style={S.notes}>{quote.notes}</Text>
          </View>
        )}

        {/* Términos y condiciones */}
        {template.terms_text && (
          <View style={[S.section, { marginTop: 8 }]}>
            <Text style={S.sectionLabel}>Términos y condiciones</Text>
            <Text style={S.notes}>{template.terms_text}</Text>
          </View>
        )}

        {/* Pie de página */}
        <View style={S.footer}>
          <Text style={S.footerText}>
            {template.footer_text || `${tenant.name} · Generado con Clickargo`}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
