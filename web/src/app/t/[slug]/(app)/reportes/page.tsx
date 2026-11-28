import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function ReportesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/t/${slug}/login`);

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: m } = await supabase
    .from("memberships")
    .select("can_see_costs")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const canSeeCosts = m?.can_see_costs === true;

  const cards = [
    {
      title: "Embarques por etapa",
      description:
        "Volumen de embarques mensual por etapa, modo, dirección y tipo de servicio.",
      href: `/t/${slug}/reportes/embarques-por-etapa`,
      show: true,
    },
    {
      title: "Puntualidad",
      description:
        "Retraso promedio por naviera. Embarques entregados tarde y ETAs vencidas activas.",
      href: `/t/${slug}/reportes/puntualidad`,
      show: true,
    },
    {
      title: "Embudo de cotizaciones",
      description:
        "Distribución de cotizaciones por estado, vendedor y mes. Tasa de conversión.",
      href: `/t/${slug}/reportes/embudo-cotizaciones`,
      show: true,
    },
    {
      title: "Rentabilidad",
      description:
        "Venta, costo y margen por embarque agrupado por cliente, ruta o mes.",
      href: `/t/${slug}/reportes/rentabilidad`,
      show: canSeeCosts,
      restricted: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Reportes</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Análisis operativos del negocio
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards
          .filter((c) => c.show)
          .map((c) => (
            <Link key={c.href} href={c.href} className="group block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <h2 className="mb-1 font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                  {c.title}
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {c.description}
                </p>
              </Card>
            </Link>
          ))}

        {!canSeeCosts && (
          <div className="sm:col-span-1">
            <Card className="opacity-60">
              <h2 className="mb-1 font-semibold text-[var(--color-text)]">
                Rentabilidad
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Requiere permiso de ver costos. Contacta al administrador.
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
