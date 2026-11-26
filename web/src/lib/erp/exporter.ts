export type PreInvoiceLine = {
  charge_type_code:  string;
  description:       string;
  quantity:          number;
  unit:              string;
  unit_price:        number;
  currency:          string;
  tax_rate:          number;
  subtotal:          number;
  tax_amount:        number;
  total:             number;
  sort_order:        number;
};

export type PreInvoiceExport = {
  id:               string;
  number:           string;
  account_name:     string;
  account_tax_id:   string | null;
  status:           string;
  currency:         string;
  subtotal:         number;
  tax_total:        number;
  total:            number;
  exchange_rate:    number | null;
  notes:            string | null;
  created_at:       string;
  lines:            PreInvoiceLine[];
};

export type ErpSendResult = {
  ref: string; // número de documento devuelto por el ERP
};

export interface ErpExporter {
  send(preInvoice: PreInvoiceExport): Promise<ErpSendResult>;
}
