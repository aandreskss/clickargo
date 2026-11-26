import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = data?.[0];
  if (!tenant || tenant.status === "cancelled") notFound();
  return <>{children}</>;
}
