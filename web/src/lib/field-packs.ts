/**
 * Paquetes de campos por país para "cuentas" (clientes, navieras, proveedores, agentes).
 * El país de la empresa decide qué campos se piden. Lo común vive en columnas;
 * lo específico del país se guarda en accounts.data (JSONB).
 */
export type PackField = { key: string; label: string; placeholder?: string; hint?: string };

export type AccountPack = {
  taxIdLabel: string;
  taxIdHint: string;
  /** Devuelve el ID normalizado, "" si está vacío, o null si es inválido. */
  normalizeTaxId: (raw: string) => string | null;
  fields: PackField[];
};

const digits = (s: string) => s.replace(/\D/g, "");

const DO: AccountPack = {
  taxIdLabel: "RNC o cédula",
  taxIdHint: "9 dígitos (RNC) u 11 dígitos (cédula). Puedes escribirlo con guiones.",
  normalizeTaxId: (raw) => {
    const d = digits(raw);
    if (!raw.trim()) return "";
    return d.length === 9 || d.length === 11 ? d : null;
  },
  fields: [
    { key: "contact_name", label: "Persona de contacto" },
    { key: "address", label: "Dirección" },
    { key: "city", label: "Ciudad o municipio", placeholder: "Santo Domingo Este" },
    { key: "province", label: "Provincia", placeholder: "Santo Domingo" },
    { key: "credit_days", label: "Días de crédito", placeholder: "0 = contado" },
  ],
};

const US: AccountPack = {
  taxIdLabel: "EIN",
  taxIdHint: "9 dígitos, formato 12-3456789.",
  normalizeTaxId: (raw) => {
    const d = digits(raw);
    if (!raw.trim()) return "";
    return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
  },
  fields: [
    { key: "contact_name", label: "Contact name" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State", placeholder: "FL" },
    { key: "zip", label: "ZIP code" },
    { key: "payment_terms", label: "Payment terms", placeholder: "Net 30" },
  ],
};

export const ACCOUNT_PACKS: Record<string, AccountPack> = { DO, US };
export const packFor = (country: string): AccountPack => ACCOUNT_PACKS[country] ?? DO;

export const ACCOUNT_KINDS = [
  { value: "customer", label: "Cliente", plural: "Clientes" },
  { value: "carrier", label: "Naviera o aerolínea", plural: "Navieras y aerolíneas" },
  { value: "vendor", label: "Proveedor", plural: "Proveedores" },
  { value: "agent", label: "Agente", plural: "Agentes" },
  { value: "other", label: "Otro", plural: "Otros" },
] as const;

export const kindLabel = (k: string) => ACCOUNT_KINDS.find((x) => x.value === k)?.label ?? k;

// ─── Cotizaciones ─────────────────────────────────────────────────────────────

export const QUOTE_SERVICE_TYPES = [
  { value: "mar_import",  label: "Mar — Importación" },
  { value: "mar_export",  label: "Mar — Exportación" },
  { value: "aire_import", label: "Aire — Importación" },
] as const;

export const serviceTypeLabel = (v: string) =>
  QUOTE_SERVICE_TYPES.find((x) => x.value === v)?.label ?? v;

export const QUOTE_STATUSES = [
  { value: "draft",     label: "Borrador",   color: "default"  as const },
  { value: "sent",      label: "Enviada",    color: "warning"  as const },
  { value: "accepted",  label: "Aceptada",   color: "success"  as const },
  { value: "expired",   label: "Vencida",    color: "danger"   as const },
  { value: "rejected",  label: "Rechazada",  color: "danger"   as const },
  { value: "converted", label: "Convertida", color: "info"     as const },
] as const;

export const statusConfig = (v: string) =>
  QUOTE_STATUSES.find((x) => x.value === v) ?? QUOTE_STATUSES[0];

// ─── Embarques ────────────────────────────────────────────────────────────────

export const SHIPMENT_MODES = [
  { value: "ocean", label: "Marítimo" },
  { value: "air",   label: "Aéreo" },
] as const;

export const SHIPMENT_DIRECTIONS = [
  { value: "import", label: "Importación" },
  { value: "export", label: "Exportación" },
] as const;

export const STAGE_LABELS: Record<string, string> = {
  draft:            "Borrador",
  booked:           "Reservado",
  picked_up:        "Recogido",
  at_origin:        "En origen",
  in_transit:       "En tránsito",
  at_destination:   "En destino",
  out_for_delivery: "En reparto",
  delivered:        "Entregado",
  completed:        "Completado",
  cancelled:        "Cancelado",
};

export type BadgeColor = "default" | "success" | "warning" | "danger" | "info";

export const STAGE_BADGE_COLORS: Record<string, BadgeColor> = {
  draft:            "default",
  booked:           "info",
  picked_up:        "info",
  at_origin:        "warning",
  in_transit:       "warning",
  at_destination:   "info",
  out_for_delivery: "warning",
  delivered:        "success",
  completed:        "success",
  cancelled:        "danger",
};

/** Labels en español para campos del embarque — usados en el botón "Avanzar" para indicar qué falta. */
export const SHIPMENT_FIELD_LABELS: Record<string, string> = {
  account_id:          "Cliente",
  mode:                "Modo de transporte",
  direction:           "Dirección (importación/exportación)",
  origin_port_id:      "Puerto de origen",
  destination_port_id: "Puerto de destino",
  carrier_account_id:  "Naviera o aerolínea",
  booking_number:      "Número de booking",
  etd:                 "Fecha estimada de salida (ETD)",
  eta:                 "Fecha estimada de llegada (ETA)",
  atd:                 "Fecha real de salida (ATD)",
  ata:                 "Fecha real de llegada (ATA)",
};

/** Convierte el service_type de una cotización al mode/direction del embarque. */
export function serviceToModeDirection(
  serviceType: string
): { mode: "ocean" | "air"; direction: "import" | "export" } | null {
  switch (serviceType) {
    case "mar_import":  return { mode: "ocean", direction: "import" };
    case "mar_export":  return { mode: "ocean", direction: "export" };
    case "aire_import": return { mode: "air",   direction: "import" };
    default:            return null;
  }
}

export const QUOTE_STATUSES_WITH_CONVERTED = [
  ...([
    { value: "draft",     label: "Borrador",    color: "default" as const },
    { value: "sent",      label: "Enviada",     color: "warning" as const },
    { value: "accepted",  label: "Aceptada",    color: "success" as const },
    { value: "expired",   label: "Vencida",     color: "danger"  as const },
    { value: "rejected",  label: "Rechazada",   color: "danger"  as const },
    { value: "converted", label: "Convertida",  color: "info"    as const },
  ] as const),
];
