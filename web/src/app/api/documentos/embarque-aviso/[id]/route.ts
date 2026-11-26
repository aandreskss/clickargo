import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { createClient }     from "@/lib/supabase/server";
import { tenantFromHost }   from "@/lib/tenant";
import { ArrivalNoticePdf } from "@/lib/pdf/arrival-notice-pdf";
import { getTenantBranding, getDocumentTemplate } from "@/lib/pdf/pdf-data";
import type { ShipmentContainer } from "@/lib/pdf/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const tenant = await tenantFromHost();
  if (!tenant) return Response.json({ error: "tenant no encontrado" }, { status: 403 });

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "no autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "sin permiso" }, { status: 403 });

  const [{ data: ship }, { data: rawContainers }] = await Promise.all([
    supabase
      .from("shipments")
      .select("id, number, mode, direction, booking_number, bl_number, origin_port_id, destination_port_id, account_id, consignee_account_id, master_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shipment_containers")
      .select("container_type_id, container_number, seal_number, weight_kg")
      .eq("shipment_id", id)
      .order("created_at"),
  ]);

  if (!ship) return Response.json({ error: "embarque no encontrado" }, { status: 404 });

  const accountId = ship.consignee_account_id ?? ship.account_id;

  const portCodes = [ship.origin_port_id, ship.destination_port_id].filter(Boolean) as string[];

  const [{ data: account }, { data: masterRow }, { data: ports }, branding, template] =
    await Promise.all([
      accountId
        ? supabase.from("accounts").select("name, tax_id, email").eq("id", accountId).maybeSingle()
        : Promise.resolve({ data: null }),
      ship.master_id
        ? supabase
            .from("masters")
            .select("vessel_or_flight, voyage, eta, master_number")
            .eq("id", ship.master_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      portCodes.length > 0
        ? supabase.from("ports").select("code, name").in("code", portCodes)
        : Promise.resolve({ data: [] }),
      getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
      getDocumentTemplate(supabase, tenant.id, "arrival_notice"),
    ]);

  const portMap = new Map((ports ?? []).map((p) => [p.code, p.name]));

  const containers: ShipmentContainer[] = (rawContainers ?? []).map((c) => ({
    container_type:   c.container_type_id ?? "—",
    container_number: c.container_number ?? null,
    seal_number:      c.seal_number ?? null,
    weight_kg:        c.weight_kg != null ? Number(c.weight_kg) : null,
    pieces:           null,
  }));

  try {
    const pdfEl = React.createElement(ArrivalNoticePdf, {
      data: {
        tenant:   branding,
        template,
        shipment: {
          number:           ship.number,
          mode:             ship.mode,
          direction:        ship.direction,
          booking_number:   ship.booking_number ?? null,
          bl_number:        ship.bl_number ?? null,
          origin_port:      ship.origin_port_id ? (portMap.get(ship.origin_port_id) ?? ship.origin_port_id) : null,
          destination_port: ship.destination_port_id ? (portMap.get(ship.destination_port_id) ?? ship.destination_port_id) : null,
        },
        master: masterRow
          ? {
              vessel_name:   masterRow.vessel_or_flight ?? null,
              voyage_number: masterRow.voyage ?? null,
              eta:           masterRow.eta ?? null,
              mbl_number:    masterRow.master_number ?? null,
            }
          : null,
        account: {
          name:   account?.name ?? "—",
          tax_id: account?.tax_id ?? null,
          email:  account?.email ?? null,
        },
        containers,
      },
    }) as unknown as React.ReactElement<DocumentProps>;

    const buffer = await renderToBuffer(pdfEl);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":           "application/pdf",
        "Content-Disposition":    `attachment; filename="aviso-llegada-${ship.number}.pdf"`,
        "Cache-Control":          "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[pdf/embarque-aviso] error al generar PDF:", err);
    return Response.json({ error: "error al generar PDF" }, { status: 500 });
  }
}
