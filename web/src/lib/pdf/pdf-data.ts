import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantBranding, PdfTemplate } from "./types";

const DEFAULT_TEMPLATE: PdfTemplate = {
  show_logo:    true,
  footer_text:  "",
  terms_text:   "",
  primary_color: "#1D4ED8",
};

/** Obtiene datos de marca del tenant e intenta convertir el logo a base64. */
export async function getTenantBranding(
  supabase: SupabaseClient,
  tenantId: string,
  logoStoragePath: string | null,
): Promise<TenantBranding> {
  const { data: extra } = await supabase
    .from("tenants")
    .select("name, tax_id, address, contact_email")
    .eq("id", tenantId)
    .single();

  let logo_base64: string | null = null;

  if (logoStoragePath) {
    const { data: signed } = await supabase.storage
      .from("tenant-assets")
      .createSignedUrl(logoStoragePath, 30);

    if (signed?.signedUrl) {
      try {
        const res = await fetch(signed.signedUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const mime = res.headers.get("content-type") ?? "image/png";
          logo_base64 = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
        }
      } catch {
        // Logo no disponible; el PDF se renderiza sin él
      }
    }
  }

  return {
    name:          extra?.name ?? "",
    logo_base64,
    tax_id:        extra?.tax_id ?? null,
    address:       extra?.address ?? null,
    contact_email: extra?.contact_email ?? null,
  };
}

/** Carga la plantilla activa de un tenant para un tipo de documento. */
export async function getDocumentTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  kind: "quote" | "arrival_notice" | "pre_invoice",
): Promise<PdfTemplate> {
  const { data } = await supabase
    .from("document_templates")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .eq("is_default", true)
    .maybeSingle();

  if (!data?.config) return DEFAULT_TEMPLATE;

  const cfg = data.config as Record<string, unknown>;
  return {
    show_logo:     typeof cfg.show_logo === "boolean" ? cfg.show_logo : true,
    footer_text:   typeof cfg.footer_text === "string" ? cfg.footer_text : "",
    terms_text:    typeof cfg.terms_text === "string" ? cfg.terms_text : "",
    primary_color: typeof cfg.primary_color === "string" ? cfg.primary_color : "#1D4ED8",
  };
}
