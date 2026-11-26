import "server-only";
import { StyleSheet } from "@react-pdf/renderer";
import type { PdfTemplate } from "./types";

const DEFAULT_PRIMARY = "#1D4ED8";  // azul corporate

function safeColor(hex: string | undefined): string {
  if (!hex) return DEFAULT_PRIMARY;
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return DEFAULT_PRIMARY;
}

export function buildStyles(template: PdfTemplate) {
  const primary = safeColor(template.primary_color);

  return StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      fontSize: 9,
      color: "#1a1a1a",
      paddingTop: 40,
      paddingBottom: 50,
      paddingHorizontal: 40,
    },
    // Encabezado
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
      paddingBottom: 16,
      borderBottomWidth: 2,
      borderBottomColor: primary,
    },
    logo: {
      width: 80,
      height: 40,
      objectFit: "contain",
    },
    tenantInfo: {
      flex: 1,
      marginLeft: 16,
    },
    tenantName: {
      fontSize: 14,
      fontFamily: "Helvetica-Bold",
      color: primary,
      marginBottom: 2,
    },
    tenantMeta: {
      fontSize: 8,
      color: "#6b7280",
      marginBottom: 1,
    },
    // Título del documento
    docTitle: {
      fontSize: 18,
      fontFamily: "Helvetica-Bold",
      color: primary,
      marginBottom: 2,
    },
    docNumber: {
      fontSize: 10,
      color: "#6b7280",
    },
    // Sección
    section: {
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: "#6b7280",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    // Grid 2 columnas
    row2: {
      flexDirection: "row",
      gap: 24,
    },
    col: {
      flex: 1,
    },
    // Datos clave-valor
    fieldLabel: {
      fontSize: 8,
      color: "#6b7280",
      marginBottom: 1,
    },
    fieldValue: {
      fontSize: 9,
      color: "#1a1a1a",
      marginBottom: 6,
    },
    fieldValueBold: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: "#1a1a1a",
    },
    // Tabla
    table: {
      marginTop: 8,
      marginBottom: 8,
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: primary,
      paddingVertical: 5,
      paddingHorizontal: 6,
    },
    tableHeaderCell: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: "#ffffff",
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    tableRowAlt: {
      backgroundColor: "#f9fafb",
    },
    tableCell: {
      fontSize: 8,
      color: "#1a1a1a",
    },
    tableCellRight: {
      fontSize: 8,
      color: "#1a1a1a",
      textAlign: "right",
    },
    tableCellMuted: {
      fontSize: 8,
      color: "#6b7280",
      textAlign: "right",
    },
    // Anchos de columna de la tabla de cotización
    colDesc:   { flex: 3 },
    colNum:    { flex: 1 },
    colMoney:  { flex: 1.2 },
    // Totales
    totalsBox: {
      alignSelf: "flex-end",
      width: 180,
      marginTop: 8,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 2,
    },
    totalLabel: {
      fontSize: 8,
      color: "#6b7280",
    },
    totalValue: {
      fontSize: 8,
      color: "#1a1a1a",
      textAlign: "right",
    },
    totalBold: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: "#e5e7eb",
    },
    totalLabelBold: {
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: "#1a1a1a",
    },
    totalValueBold: {
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: primary,
      textAlign: "right",
    },
    // Notas y pie
    notes: {
      fontSize: 8,
      color: "#4b5563",
      marginTop: 4,
      lineHeight: 1.4,
    },
    footer: {
      position: "absolute",
      bottom: 20,
      left: 40,
      right: 40,
      borderTopWidth: 0.5,
      borderTopColor: "#e5e7eb",
      paddingTop: 8,
    },
    footerText: {
      fontSize: 7,
      color: "#9ca3af",
      textAlign: "center",
      lineHeight: 1.4,
    },
    footerDisclaimer: {
      fontSize: 7,
      color: "#ef4444",
      textAlign: "center",
      marginTop: 2,
    },
    // Marca de agua BORRADOR
    watermark: {
      position: "absolute",
      top: "40%",
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: 72,
      fontFamily: "Helvetica-Bold",
      color: "#e5e7eb",
      opacity: 0.5,
      transform: "rotate(-45deg)",
    },
    // Badge de estado
    badge: {
      alignSelf: "flex-start",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginTop: 2,
    },
    badgeText: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
    },
    // Separador
    divider: {
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
      marginVertical: 12,
    },
  });
}
