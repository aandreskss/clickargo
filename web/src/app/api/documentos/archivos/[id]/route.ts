import { createClient }     from "@/lib/supabase/server";
import { tenantFromHost }   from "@/lib/tenant";
import { getSignedDownloadUrl } from "@/lib/documents/storage";

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

  // RLS garantiza que solo se devuelven documentos del tenant con scan_status='clean'
  const { data: doc } = await supabase
    .from("shipment_documents")
    .select("storage_path, title, mime_type")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return Response.json({ error: "documento no encontrado" }, { status: 404 });

  const signedUrl = await getSignedDownloadUrl(doc.storage_path, supabase, tenant.id);
  if (!signedUrl) return Response.json({ error: "no se pudo generar la URL de descarga" }, { status: 500 });

  const safeTitle = encodeURIComponent(doc.title.replace(/[^\w\s.-]/g, "_"));

  return Response.redirect(signedUrl, 302);
}
