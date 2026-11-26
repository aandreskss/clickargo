import "server-only";

export type TenantBranding = {
  name: string;
  logo_base64: string | null;  // imagen del logo ya convertida a base64 (o null)
  tax_id: string | null;
  address: string | null;
  contact_email: string | null;
};

export type PdfTemplate = {
  show_logo: boolean;
  footer_text: string;
  terms_text: string;
  primary_color: string;  // hex: "#0066CC" — fallback a azul si vacío
};

export type QuoteLineItem = {
  service: string;
  qty: number;
  unit_price: number;
  taxable: boolean;
  currency: string;
};

export type QuoteTotals = {
  subtotal: number;
  itbis: number;
  total: number;
};

export type QuotePdfData = {
  tenant: TenantBranding;
  template: PdfTemplate;
  quote: {
    number: string;
    status: string;
    service_type: string;
    origin: string | null;
    destination: string | null;
    currency: string;
    notes: string | null;
    valid_until: string | null;
    created_at: string;
  };
  account: {
    name: string;
    tax_id: string | null;
    contact_name: string | null;
    email: string | null;
  };
  lines: QuoteLineItem[];
  totals: QuoteTotals;
};

export type ShipmentContainer = {
  container_type: string;
  container_number: string | null;
  seal_number: string | null;
  weight_kg: number | null;
  pieces: number | null;
};

export type ArrivalNoticePdfData = {
  tenant: TenantBranding;
  template: PdfTemplate;
  shipment: {
    number: string;
    mode: string;
    direction: string;
    booking_number: string | null;
    bl_number: string | null;
    origin_port: string | null;
    destination_port: string | null;
  };
  master: {
    vessel_name: string | null;
    voyage_number: string | null;
    eta: string | null;
    mbl_number: string | null;
  } | null;
  account: {
    name: string;
    tax_id: string | null;
    email: string | null;
  };
  containers: ShipmentContainer[];
};

export type PreInvoiceLineItem = {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  currency: string;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
  total: number;
};

export type PreInvoicePdfData = {
  tenant: TenantBranding;
  template: PdfTemplate;
  pre_invoice: {
    number: string;
    status: string;
    currency: string;
    subtotal: number;
    tax_total: number;
    total: number;
    exchange_rate: number | null;
    notes: string | null;
    created_at: string;
  };
  account: {
    name: string;
    tax_id: string | null;
    email: string | null;
  };
  lines: PreInvoiceLineItem[];
};
