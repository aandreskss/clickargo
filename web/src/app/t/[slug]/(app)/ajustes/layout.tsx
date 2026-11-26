import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { errUrl } from "@/lib/messages";
import type { ReactNode } from "react";

export default async function AjustesLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: m } = await supabase
    .from("memberships").select("role")
    .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();

  if (!m || (m.role !== "owner" && m.role !== "admin")) {
    redirect(errUrl("/", "sin_permiso_ajustes"));
  }

  return <>{children}</>;
}
