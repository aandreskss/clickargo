import "server-only";
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { buildStyles } from "./theme";
import type { ArrivalNoticePdfData } from "./types";

const MODE_LABELS: Record<string, string> = {
  ocean: "Marítimo",
  air: "Aéreo",
};

const DIR_LABELS: Record<string, string> = {
  import: "Importación",
  export: "Exportación",
};

const CONTAINER_TYPE_LABELS: Record<string, string> = {
  "20DC": "20' Dry",
  "40DC": "40' Dry",
  "40HC": "40' High Cube",
  "20RF": "20' Reefer",
  "40RF": "40' Reefer",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "Pendiente";
  return new Date(iso).toLocaleDateString("es-DO", {
    year: "numeric", month: "long", day: "numeric",
  });
}

const DEFAULT_STEPS = `1. Presentar documentos de desaduanización antes del arribo.
2. Coordinar retiro con el agente aduanal.
3. Contactar nuestra oficina para coordinar entrega.`;

export function ArrivalNoticePdf({ data }: { data: ArrivalNoticePdfData }) {
  const S = buildStyles(data.template);
  const { tenant, template, shipment, master, account, containers } = data;
  const modeLabel = MODE_LABELS[shipment.mode] ?? shipment.mode;
  const dirLabel  = DIR_LABELS[shipment.direction] ?? shipment.direction;

  return (
    <Document
      title={`Aviso de llegada ${shipment.number}`}
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
            <Text style={S.docTitle}>AVISO DE LLEGADA</Text>
            <Text style={S.docNumber}>{shipment.number}</Text>
            <Text style={S.fieldLabel}>{modeLabel} · {dirLabel}</Text>
            <Text style={S.fieldLabel}>Fecha: {fmtDate(new Date().toISOString())}</Text>
          </View>
        </View>

        {/* Destinatario */}
        <View style={S.section}>
          <Text style={S.sectionLabel}>Consignatario / Cliente</Text>
          <Text style={S.fieldValueBold}>{account.name}</Text>
          {account.tax_id && (
            <Text style={S.fieldLabel}>RNC / ID: {account.tax_id}</Text>
          )}
          {account.email && (
            <Text style={S.fieldLabel}>{account.email}</Text>
          )}
        </View>

        <View style={S.divider} />

        {/* Datos del embarque */}
        <Text style={S.sectionLabel}>Datos del embarque</Text>
        <View style={[S.row2, { marginTop: 6, marginBottom: 16 }]}>
          <View style={S.col}>
            {shipment.bl_number && (
              <>
                <Text style={S.fieldLabel}>BL / AWB</Text>
                <Text style={S.fieldValue}>{shipment.bl_number}</Text>
              </>
            )}
            {shipment.booking_number && (
              <>
                <Text style={S.fieldLabel}>Booking</Text>
                <Text style={S.fieldValue}>{shipment.booking_number}</Text>
              </>
            )}
            <Text style={S.fieldLabel}>Puerto de origen</Text>
            <Text style={S.fieldValue}>{shipment.origin_port ?? "—"}</Text>
          </View>
          <View style={S.col}>
            <Text style={S.fieldLabel}>Puerto de destino</Text>
            <Text style={S.fieldValue}>{shipment.destination_port ?? "—"}</Text>
            <Text style={S.fieldLabel}>{shipment.mode === "air" ? "Vuelo" : "Buque / Viaje"}</Text>
            <Text style={S.fieldValue}>
              {master
                ? [master.vessel_name, master.voyage_number].filter(Boolean).join(" / ") || "—"
                : "Pendiente"}
            </Text>
            <Text style={S.fieldLabel}>ETA</Text>
            <Text style={[S.fieldValue, { fontFamily: "Helvetica-Bold" }]}>
              {master ? fmtDate(master.eta) : "Pendiente"}
            </Text>
          </View>
        </View>

        {/* Contenedores/bultos (si los hay) */}
        {containers.length > 0 && (
          <>
            <View style={S.divider} />
            <Text style={S.sectionLabel}>Contenedores / Carga</Text>
            <View style={S.table}>
              <View style={S.tableHeader}>
                <Text style={[S.tableHeaderCell, { flex: 2 }]}>Tipo</Text>
                <Text style={[S.tableHeaderCell, { flex: 2 }]}>Número</Text>
                <Text style={[S.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Peso (kg)</Text>
                <Text style={[S.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Bultos</Text>
              </View>
              {containers.map((c, i) => (
                <View key={i} style={[S.tableRow, i % 2 === 1 ? S.tableRowAlt : {}]}>
                  <Text style={[S.tableCell, { flex: 2 }]}>
                    {CONTAINER_TYPE_LABELS[c.container_type] ?? c.container_type}
                  </Text>
                  <Text style={[S.tableCell, { flex: 2 }]}>
                    {c.container_number ?? "—"}
                  </Text>
                  <Text style={[S.tableCellRight, { flex: 1 }]}>
                    {c.weight_kg != null ? c.weight_kg.toLocaleString("es-DO") : "—"}
                  </Text>
                  <Text style={[S.tableCellRight, { flex: 1 }]}>
                    {c.pieces != null ? c.pieces.toLocaleString("es-DO") : "—"}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Pasos siguientes */}
        <View style={{ marginTop: 20 }}>
          <Text style={S.sectionLabel}>Pasos siguientes</Text>
          <Text style={S.notes}>
            {template.terms_text || DEFAULT_STEPS}
          </Text>
        </View>

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
