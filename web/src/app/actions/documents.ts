"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { createClient }     from "@/lib/supabase/server";
import { tenantFromHost }   from "@/lib/tenant";
import { errUrl, okUrl }    from "@/lib/messages";
import { validateDocumentFile, validateDocumentBytes } from "@/lib/documents/validate";
import { safeFileName, documentStoragePath }           from "@/lib/documents/sanitize";
import { getTenantBranding, getDocumentTemplate }      from "@/lib/pdf/pdf-data";
import { QuotePdf }         from "@/lib/pdf/quote-pdf";
import { ArrivalNoticePdf } from "@/lib/pdf/arrival-notice-pdf";
import { PreInvoicePdf }    from "@/lib/pdf/pre-invoice-pdf";
import { sendWithPdfAttachment } from "@/lib/mail/send";
import type { QuoteLineItem, QuoteTotals, ShipmentContainer, PreInvoiceLineItem } from "@/lib/pdf/types";
import { can }              from "@/lib/permissions";
import type { Role }        from "@/lib/permissions";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ── Subir documento de embarque ───────────────────────────────────────────────

export async function uploadShipmentDocument(formData: FormData) {
  const shipmentId = str(formData, "shipment_id");
  const kind       = str(formData, "kind") || "other";
  const title      = str(formData, "title");
  const back       = `/embarques/${shipmentId}?tab=documentos`;

  if (!UUID_RE.test(shipmentId)) redirect(errUrl(back, "id_invalido"));

  const tenant  = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership) redirect(errUrl(back, "sin_permiso_crear"));

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(errUrl(back, "error_generico"));

  // Validación client-side replicada en servidor (MIME + tamaño)
  const fileCheck = validateDocumentFile(file);
  if (!fileCheck.ok) redirect(errUrl(back, fileCheck.code));

  // Leer bytes y validar firma real
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bytesCheck = await validateDocumentBytes(bytes, file.type);
  if (!bytesCheck.ok) redirect(errUrl(back, bytesCheck.code));

  const safeName   = safeFileName(file.type);
  const storagePath = documentStoragePath(tenant.id, shipmentId, safeName);

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) redirect(errUrl(back, "error_generico"));

  const docTitle = title || file.name.slice(0, 200) || safeName;

  const { error: dbError } = await supabase.from("shipment_documents").insert({
    tenant_id:   tenant.id,
    shipment_id: shipmentId,
    kind,
    title:       docTitle,
    storage_path: storagePath,
    mime_type:   file.type,
    size_bytes:  file.size,
    scan_status: "clean",
    visible_to_customer: false,
    uploaded_by: user.id,
  });

  if (dbError) {
    // Limpiar el archivo subido si falla el INSERT
    await supabase.storage.from("documents").remove([storagePath]);
    redirect(errUrl(back, "error_generico"));
  }

  revalidatePath(back);
  redirect(okUrl(back, "documento_subido"));
}

// ── Eliminar documento de embarque ────────────────────────────────────────────

export async function deleteShipmentDocument(formData: FormData) {
  const docId      = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  const back       = `/embarques/${shipmentId}?tab=documentos`;

  if (!UUID_RE.test(docId) || !UUID_RE.test(shipmentId)) redirect(errUrl(back, "id_invalido"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership) redirect(errUrl(back, "sin_permiso_eliminar"));

  const { data: doc } = await supabase
    .from("shipment_documents").select("storage_path, uploaded_by")
    .eq("id", docId).maybeSingle();
  if (!doc) redirect(errUrl(back, "id_invalido"));

  const isOwner    = doc.uploaded_by === user.id;
  const canDelete  = can(membership.role as Role, "documents", "delete");
  if (!isOwner && !canDelete) redirect(errUrl(back, "sin_permiso_eliminar"));

  await supabase.storage.from("documents").remove([doc.storage_path]);

  const { error } = await supabase.from("shipment_documents").delete().eq("id", docId);
  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(back);
  redirect(okUrl(back, "documento_eliminado"));
}

// ── Enviar cotización por correo ───────────────────────────────────────────────

export async function sendQuotePdf(formData: FormData) {
  const quoteId = str(formData, "document_id");
  const to      = str(formData, "to_email");
  const subject = str(formData, "subject");
  const body    = str(formData, "body");
  const back    = `/cotizaciones/${quoteId}`;

  if (!UUID_RE.test(quoteId)) redirect(errUrl(back, "id_invalido"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership) redirect(errUrl(back, "sin_permiso_crear"));

  const [{ data: quote }, { data: rawLines }] = await Promise.all([
    supabase.from("quotes")
      .select("id, number, status, service_type, origin, destination, currency, notes, valid_until, created_at, account_id")
      .eq("id", quoteId).maybeSingle(),
    supabase.from("quote_lines")
      .select("service, qty, unit_price, currency, taxable, sort_order")
      .eq("quote_id", quoteId).order("sort_order"),
  ]);
  if (!quote) redirect(errUrl(back, "id_invalido"));

  const [{ data: account }, branding, template] = await Promise.all([
    supabase.from("accounts").select("name, tax_id, email").eq("id", quote.account_id).maybeSingle(),
    getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
    getDocumentTemplate(supabase, tenant.id, "quote"),
  ]);

  const lines: QuoteLineItem[] = (rawLines ?? []).map((l) => ({
    service: l.service, qty: Number(l.qty), unit_price: Number(l.unit_price),
    taxable: Boolean(l.taxable), currency: l.currency,
  }));
  const sub  = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const itb  = lines.reduce((s, l) => s + (l.taxable ? l.qty * l.unit_price * 0.18 : 0), 0);
  const totals: QuoteTotals = { subtotal: sub, itbis: itb, total: sub + itb };

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(
      React.createElement(QuotePdf, {
        data: {
          tenant: branding, template,
          quote: {
            number: quote.number, status: quote.status, service_type: quote.service_type,
            origin: quote.origin ?? null, destination: quote.destination ?? null,
            currency: quote.currency, notes: quote.notes ?? null,
            valid_until: quote.valid_until ?? null, created_at: quote.created_at,
          },
          account: { name: account?.name ?? "—", tax_id: account?.tax_id ?? null, contact_name: null, email: account?.email ?? null },
          lines, totals,
        },
      }) as unknown as React.ReactElement<DocumentProps>,
    );
  } catch {
    redirect(errUrl(back, "pdf_error"));
  }

  const result = await sendWithPdfAttachment({
    supabase, tenantId: tenant.id, userId: user.id,
    to, subject: subject || `Cotización ${quote.number}`,
    body,
    pdfBytes:    new Uint8Array(buffer!),
    pdfFilename: `cotizacion-${quote.number}.pdf`,
    template: "quote", relatedType: "quote", relatedId: quoteId,
  });

  if (!result.ok) redirect(errUrl(back, result.code));
  redirect(okUrl(back, "correo_enviado"));
}

// ── Enviar aviso de llegada por correo ────────────────────────────────────────

export async function sendArrivalNoticePdf(formData: FormData) {
  const shipmentId = str(formData, "document_id");
  const to         = str(formData, "to_email");
  const subject    = str(formData, "subject");
  const body       = str(formData, "body");
  const back       = `/embarques/${shipmentId}`;

  if (!UUID_RE.test(shipmentId)) redirect(errUrl(back, "id_invalido"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership || !can(membership.role as Role, "documents", "send_email")) {
    redirect(errUrl(back, "sin_permiso_crear"));
  }

  const [{ data: ship }, { data: rawContainers }] = await Promise.all([
    supabase.from("shipments")
      .select("id, number, mode, direction, booking_number, bl_number, origin_port_id, destination_port_id, account_id, consignee_account_id, master_id")
      .eq("id", shipmentId).maybeSingle(),
    supabase.from("shipment_containers")
      .select("container_type_id, container_number, seal_number, weight_kg")
      .eq("shipment_id", shipmentId).order("created_at"),
  ]);
  if (!ship) redirect(errUrl(back, "id_invalido"));

  const accountId  = ship.consignee_account_id ?? ship.account_id;
  const portCodes  = [ship.origin_port_id, ship.destination_port_id].filter(Boolean) as string[];

  const [{ data: account }, { data: masterRow }, { data: ports }, branding, template] = await Promise.all([
    accountId ? supabase.from("accounts").select("name, tax_id, email").eq("id", accountId).maybeSingle() : Promise.resolve({ data: null }),
    ship.master_id ? supabase.from("masters").select("vessel_or_flight, voyage, eta, master_number").eq("id", ship.master_id).maybeSingle() : Promise.resolve({ data: null }),
    portCodes.length > 0 ? supabase.from("ports").select("code, name").in("code", portCodes) : Promise.resolve({ data: [] }),
    getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
    getDocumentTemplate(supabase, tenant.id, "arrival_notice"),
  ]);

  const portMap    = new Map((ports ?? []).map((p) => [p.code, p.name]));
  const containers: ShipmentContainer[] = (rawContainers ?? []).map((c) => ({
    container_type: c.container_type_id ?? "—", container_number: c.container_number ?? null,
    seal_number: c.seal_number ?? null, weight_kg: c.weight_kg != null ? Number(c.weight_kg) : null, pieces: null,
  }));

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(
      React.createElement(ArrivalNoticePdf, {
        data: {
          tenant: branding, template,
          shipment: {
            number: ship.number, mode: ship.mode, direction: ship.direction,
            booking_number: ship.booking_number ?? null, bl_number: ship.bl_number ?? null,
            origin_port:      ship.origin_port_id ? (portMap.get(ship.origin_port_id) ?? ship.origin_port_id) : null,
            destination_port: ship.destination_port_id ? (portMap.get(ship.destination_port_id) ?? ship.destination_port_id) : null,
          },
          master: masterRow ? { vessel_name: masterRow.vessel_or_flight ?? null, voyage_number: masterRow.voyage ?? null, eta: masterRow.eta ?? null, mbl_number: masterRow.master_number ?? null } : null,
          account: { name: account?.name ?? "—", tax_id: account?.tax_id ?? null, email: account?.email ?? null },
          containers,
        },
      }) as unknown as React.ReactElement<DocumentProps>,
    );
  } catch {
    redirect(errUrl(back, "pdf_error"));
  }

  const result = await sendWithPdfAttachment({
    supabase, tenantId: tenant.id, userId: user.id,
    to, subject: subject || `Aviso de llegada ${ship.number}`,
    body,
    pdfBytes:    new Uint8Array(buffer!),
    pdfFilename: `aviso-llegada-${ship.number}.pdf`,
    template: "arrival_notice", relatedType: "shipment", relatedId: shipmentId,
  });

  if (!result.ok) redirect(errUrl(back, result.code));
  redirect(okUrl(back, "correo_enviado"));
}

// ── Enviar prefactura por correo ───────────────────────────────────────────────

const PREINVOICE_EMAIL_ROLES = ["owner", "admin", "finance", "manager"];

export async function sendPreInvoicePdf(formData: FormData) {
  const piId   = str(formData, "document_id");
  const to     = str(formData, "to_email");
  const subject = str(formData, "subject");
  const body   = str(formData, "body");
  const back   = `/prefacturas/${piId}`;

  if (!UUID_RE.test(piId)) redirect(errUrl(back, "id_invalido"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership || !PREINVOICE_EMAIL_ROLES.includes(membership.role)) {
    redirect(errUrl(back, "sin_permiso_crear"));
  }

  const [{ data: pi }, { data: rawLines }] = await Promise.all([
    supabase.from("pre_invoices")
      .select("id, number, status, currency, subtotal, tax_total, total, exchange_rate, notes, created_at, account_id")
      .eq("id", piId).maybeSingle(),
    supabase.from("pre_invoice_lines")
      .select("description, quantity, unit, unit_price, currency, tax_rate, subtotal, tax_amount, total, sort_order")
      .eq("pre_invoice_id", piId).order("sort_order"),
  ]);
  if (!pi) redirect(errUrl(back, "id_invalido"));

  const [{ data: account }, branding, template] = await Promise.all([
    supabase.from("accounts").select("name, tax_id, email").eq("id", pi.account_id).maybeSingle(),
    getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
    getDocumentTemplate(supabase, tenant.id, "pre_invoice"),
  ]);

  const lines: PreInvoiceLineItem[] = (rawLines ?? []).map((l) => ({
    description: l.description, quantity: Number(l.quantity), unit: l.unit,
    unit_price: Number(l.unit_price), currency: l.currency, tax_rate: Number(l.tax_rate),
    subtotal: Number(l.subtotal), tax_amount: Number(l.tax_amount), total: Number(l.total),
  }));

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(
      React.createElement(PreInvoicePdf, {
        data: {
          tenant: branding, template,
          pre_invoice: {
            number: pi.number, status: pi.status, currency: pi.currency,
            subtotal: Number(pi.subtotal), tax_total: Number(pi.tax_total), total: Number(pi.total),
            exchange_rate: pi.exchange_rate ? Number(pi.exchange_rate) : null,
            notes: pi.notes ?? null, created_at: pi.created_at,
          },
          account: { name: account?.name ?? "—", tax_id: account?.tax_id ?? null, email: account?.email ?? null },
          lines,
        },
      }) as unknown as React.ReactElement<DocumentProps>,
    );
  } catch {
    redirect(errUrl(back, "pdf_error"));
  }

  const result = await sendWithPdfAttachment({
    supabase, tenantId: tenant.id, userId: user.id,
    to, subject: subject || `Prefactura ${pi.number}`,
    body,
    pdfBytes:    new Uint8Array(buffer!),
    pdfFilename: `prefactura-${pi.number}.pdf`,
    template: "pre_invoice", relatedType: "pre_invoice", relatedId: piId,
  });

  if (!result.ok) redirect(errUrl(back, result.code));
  redirect(okUrl(back, "correo_enviado"));
}

// ── Actualizar visibilidad de documento para el portal ───────────────────────

export async function toggleDocumentVisibility(formData: FormData) {
  const docId      = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  const visible    = formData.get("visible") === "true";
  const back       = `/embarques/${shipmentId}?tab=documentos`;

  if (!UUID_RE.test(docId) || !UUID_RE.test(shipmentId)) redirect(errUrl(back, "id_invalido"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership || !can(membership.role as Role, "documents", "edit")) {
    redirect(errUrl(back, "sin_permiso_editar"));
  }

  const { error } = await supabase
    .from("shipment_documents")
    .update({ visible_to_customer: visible })
    .eq("id", docId)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(back);
  redirect(okUrl(back, "visibilidad_actualizada"));
}

// ── Actualizar plantilla de documento ─────────────────────────────────────────

const TemplateConfigSchema = z.object({
  id:            z.string().uuid(),
  show_logo:     z.coerce.boolean(),
  footer_text:   z.string().max(500).optional().default(""),
  terms_text:    z.string().max(1000).optional().default(""),
  primary_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default("#1D4ED8"),
});

export async function updateDocumentTemplate(formData: FormData) {
  const back = "/ajustes/plantillas";

  const parsed = TemplateConfigSchema.safeParse({
    id:            str(formData, "id"),
    show_logo:     formData.get("show_logo") === "true" || formData.get("show_logo") === "on",
    footer_text:   str(formData, "footer_text"),
    terms_text:    str(formData, "terms_text"),
    primary_color: str(formData, "primary_color") || "#1D4ED8",
  });
  if (!parsed.success) redirect(errUrl(back, "error_generico"));

  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: membership } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect(errUrl(back, "sin_permiso_ajustes"));
  }

  const { id, show_logo, footer_text, terms_text, primary_color } = parsed.data;

  const { error } = await supabase
    .from("document_templates")
    .update({ config: { show_logo, footer_text, terms_text, primary_color } })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(back);
  redirect(okUrl(back, "plantilla_guardada"));
}
