"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreateQuoteSchema,
  UpdateQuoteSchema,
  ChangeStatusSchema,
  QuoteLineSchema,
  QuoteLineCostSchema,
} from "@/lib/schemas/quote.schema";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";
import { z } from "zod";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

type Supabase = Awaited<ReturnType<typeof createClient>>;

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:    ["sent"],
  sent:     ["accepted", "rejected", "draft"],
  accepted: ["draft"],
  rejected: ["draft"],
  expired:  ["draft"],
};

async function getCanSeeCosts(supabase: Supabase, tenantId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: m } = await supabase
    .from("memberships")
    .select("can_see_costs")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();
  return m?.can_see_costs === true;
}

function parseLinesJson(raw: string, back: string): z.infer<typeof QuoteLineSchema>[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw || "[]"); } catch { redirect(errUrl(back, "error_generico")); }
  const result = z.array(QuoteLineSchema).min(1).safeParse(parsed);
  if (!result.success) redirect(errUrl(back, "lineas_obligatorias"));
  return result.data;
}

function parseCostsJson(raw: string, back: string): z.infer<typeof QuoteLineCostSchema>[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { redirect(errUrl(back, "error_generico")); }
  const result = z.array(QuoteLineCostSchema).safeParse(parsed);
  if (!result.success) redirect(errUrl(back, "error_generico"));
  return result.data;
}

async function insertCosts(
  supabase: Supabase,
  tenantId: string,
  costs: z.infer<typeof QuoteLineCostSchema>[],
  lineIds: { id: string; sort_order: number }[],
) {
  const rows = costs
    .map((c) => {
      const line = lineIds[c.line_index];
      if (!line) return null;
      return {
        tenant_id:     tenantId,
        quote_line_id: line.id,
        cost:          c.cost,
        currency:      c.currency,
        vendor_id:     c.vendor_id || null,
        notes:         c.notes || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    await supabase.from("quote_line_costs").insert(rows);
  }
}

export async function createQuote(formData: FormData) {
  const back = "/cotizaciones/nueva";
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const lines = parseLinesJson(str(formData, "lines"), back);

  const quoteResult = CreateQuoteSchema.omit({ lines: true, line_costs: true }).safeParse({
    account_id:   str(formData, "account_id"),
    service_type: str(formData, "service_type"),
    origin:       str(formData, "origin") || undefined,
    destination:  str(formData, "destination") || undefined,
    currency:     str(formData, "currency") || "USD",
    notes:        str(formData, "notes") || undefined,
    valid_until:  str(formData, "valid_until") || undefined,
  });

  if (!quoteResult.success) {
    const issue = quoteResult.error.issues[0]?.path?.[0];
    const key: MsgKey = issue === "account_id" ? "cliente_obligatorio"
      : issue === "service_type" ? "servicio_obligatorio"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  const supabase = await createClient();
  const canSeeCosts = await getCanSeeCosts(supabase, tenant.id);
  const costs = canSeeCosts ? parseCostsJson(str(formData, "line_costs"), back) : [];

  const { data: quotePrefix } = await supabase.rpc("get_entity_prefix", {
    _tenant: tenant.id,
    _key:    "quotes",
  });
  const { data: number, error: numErr } = await supabase.rpc("next_number", {
    _tenant: tenant.id,
    _key:    "quotes",
    _prefix: (quotePrefix as string | null) ?? "BXCT-",
  });
  if (numErr || !number) redirect(errUrl(back, "error_generico"));

  const q = quoteResult.data;
  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id:    tenant.id,
      number:       number as string,
      account_id:   q.account_id,
      service_type: q.service_type,
      origin:       q.origin || null,
      destination:  q.destination || null,
      currency:     q.currency,
      notes:        q.notes || null,
      valid_until:  q.valid_until || null,
    })
    .select("id")
    .single();

  if (qErr || !quote) {
    const key: MsgKey = /row-level security/i.test(qErr?.message ?? "") ? "sin_permiso_crear" : "error_generico";
    redirect(errUrl(back, key));
  }

  const { data: insertedLines, error: lErr } = await supabase
    .from("quote_lines")
    .insert(
      lines.map((l, i) => ({
        tenant_id:  tenant.id,
        quote_id:   quote.id,
        service:    l.service,
        qty:        l.qty,
        unit_price: l.unit_price,
        currency:   l.currency,
        taxable:    l.taxable,
        sort_order: i,
      }))
    )
    .select("id, sort_order")
    .order("sort_order");

  if (lErr || !insertedLines) {
    await supabase.from("quotes").delete().eq("id", quote.id);
    redirect(errUrl(back, "error_generico"));
  }

  if (canSeeCosts && costs.length > 0) {
    await insertCosts(supabase, tenant.id, costs, insertedLines);
  }

  revalidatePath("/cotizaciones");
  redirect(okUrl("/cotizaciones", "cotizacion_guardada"));
}

export async function updateQuote(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/cotizaciones", "id_invalido"));
  const back = `/cotizaciones/${id}/editar`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("quotes").select("status").eq("id", id).maybeSingle();
  if (!existing || existing.status !== "draft") {
    redirect(errUrl(`/cotizaciones/${id}`, "cotizacion_no_editable"));
  }

  const lines = parseLinesJson(str(formData, "lines"), back);

  const quoteResult = UpdateQuoteSchema.omit({ lines: true, line_costs: true }).safeParse({
    id,
    account_id:   str(formData, "account_id"),
    service_type: str(formData, "service_type"),
    origin:       str(formData, "origin") || undefined,
    destination:  str(formData, "destination") || undefined,
    currency:     str(formData, "currency") || "USD",
    notes:        str(formData, "notes") || undefined,
    valid_until:  str(formData, "valid_until") || undefined,
  });

  if (!quoteResult.success) redirect(errUrl(back, "error_generico"));

  const canSeeCosts = await getCanSeeCosts(supabase, tenant.id);
  const costs = canSeeCosts ? parseCostsJson(str(formData, "line_costs"), back) : [];

  const q = quoteResult.data;
  const { error: upErr } = await supabase.from("quotes").update({
    account_id:   q.account_id,
    service_type: q.service_type,
    origin:       q.origin || null,
    destination:  q.destination || null,
    currency:     q.currency,
    notes:        q.notes || null,
    valid_until:  q.valid_until || null,
  }).eq("id", id);

  if (upErr) {
    const key: MsgKey = /row-level security/i.test(upErr.message) ? "sin_permiso_editar" : "error_generico";
    redirect(errUrl(back, key));
  }

  // Eliminar líneas viejas (el CASCADE borra los costos automáticamente)
  await supabase.from("quote_lines").delete().eq("quote_id", id);

  const { data: newLines, error: lErr } = await supabase
    .from("quote_lines")
    .insert(
      lines.map((l, i) => ({
        tenant_id:  tenant.id,
        quote_id:   id,
        service:    l.service,
        qty:        l.qty,
        unit_price: l.unit_price,
        currency:   l.currency,
        taxable:    l.taxable,
        sort_order: i,
      }))
    )
    .select("id, sort_order")
    .order("sort_order");

  if (lErr || !newLines) redirect(errUrl(back, "error_generico"));

  if (canSeeCosts && costs.length > 0) {
    await insertCosts(supabase, tenant.id, costs, newLines);
  }

  revalidatePath("/cotizaciones");
  revalidatePath(`/cotizaciones/${id}`);
  redirect(okUrl(`/cotizaciones/${id}`, "cotizacion_actualizada"));
}

export async function changeQuoteStatus(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/cotizaciones", "id_invalido"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(`/cotizaciones/${id}`, "empresa_suspendida"));

  const result = ChangeStatusSchema.safeParse({ id, status: str(formData, "status") });
  if (!result.success) redirect(errUrl(`/cotizaciones/${id}`, "estado_invalido"));

  const { status: newStatus } = result.data;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("quotes").select("status").eq("id", id).maybeSingle();
  if (!existing) redirect(errUrl("/cotizaciones", "id_invalido"));

  const allowed = VALID_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(newStatus)) {
    redirect(errUrl(`/cotizaciones/${id}`, "estado_invalido"));
  }

  const { error } = await supabase.from("quotes").update({ status: newStatus }).eq("id", id);
  if (error) redirect(errUrl(`/cotizaciones/${id}`, "error_generico"));

  const okKeys: Record<string, MsgKey> = {
    sent:     "cotizacion_enviada",
    accepted: "cotizacion_aceptada",
    rejected: "cotizacion_rechazada",
    draft:    "cotizacion_actualizada",
    expired:  "cotizacion_actualizada",
  };
  revalidatePath("/cotizaciones");
  revalidatePath(`/cotizaciones/${id}`);
  redirect(okUrl(`/cotizaciones/${id}`, okKeys[newStatus] ?? "cotizacion_actualizada"));
}

export async function duplicateQuote(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/cotizaciones", "id_invalido"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl("/cotizaciones", "empresa_suspendida"));

  const supabase = await createClient();

  const { data: original } = await supabase
    .from("quotes")
    .select("account_id, service_type, origin, destination, currency, notes, valid_until")
    .eq("id", id)
    .maybeSingle();
  if (!original) redirect(errUrl("/cotizaciones", "id_invalido"));

  const { data: originalLines } = await supabase
    .from("quote_lines")
    .select("service, qty, unit_price, currency, taxable, sort_order")
    .eq("quote_id", id)
    .order("sort_order");

  const { data: number, error: numErr } = await supabase.rpc("next_number", {
    _tenant: tenant.id,
    _key:    "quotes",
    _prefix: "COT-",
  });
  if (numErr || !number) redirect(errUrl("/cotizaciones", "error_generico"));

  const { data: newQuote, error: qErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id:    tenant.id,
      number:       number as string,
      account_id:   original.account_id,
      service_type: original.service_type,
      origin:       original.origin,
      destination:  original.destination,
      currency:     original.currency,
      notes:        original.notes,
      valid_until:  original.valid_until,
      status:       "draft",
    })
    .select("id")
    .single();

  if (qErr || !newQuote) redirect(errUrl("/cotizaciones", "error_generico"));

  if (originalLines?.length) {
    await supabase.from("quote_lines").insert(
      originalLines.map((l) => ({
        tenant_id:  tenant.id,
        quote_id:   newQuote.id,
        service:    l.service,
        qty:        l.qty,
        unit_price: l.unit_price,
        currency:   l.currency,
        taxable:    l.taxable,
        sort_order: l.sort_order,
      }))
    );
  }

  revalidatePath("/cotizaciones");
  redirect(okUrl(`/cotizaciones/${newQuote.id}`, "cotizacion_duplicada"));
}

export async function deleteQuote(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/cotizaciones", "id_invalido"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl("/cotizaciones", "empresa_suspendida"));

  const supabase = await createClient();
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message) ? "sin_permiso_eliminar" : "error_generico";
    redirect(errUrl("/cotizaciones", key));
  }
  revalidatePath("/cotizaciones");
  redirect(okUrl("/cotizaciones", "cotizacion_eliminada"));
}
