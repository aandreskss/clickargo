import { notFound } from "next/navigation";
import {
  Button, Field, Select, Textarea, Card, Table, Tr, Td,
  Tabs, EmptyState, Badge, Notice, PageHeader, Stepper,
} from "@/components/ui";

export default function DesignGallery() {
  if (process.env.NODE_ENV !== "development") notFound();

  const sampleTabs = [
    { value: "a", label: "Pestaña A", href: "?t=a" },
    { value: "b", label: "Pestaña B", href: "?t=b" },
    { value: "c", label: "Pestaña C", href: "?t=c" },
  ];

  const sampleSteps = [
    { label: "Datos básicos",   description: "Nombre, origen, destino" },
    { label: "Líneas",          description: "Cargos y precios"        },
    { label: "Revisión",        description: "Confirmar y guardar"     },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6">
      <PageHeader
        title="Galería de componentes"
        subtitle="Solo visible en desarrollo. Cambiar un token en globals.css actualiza toda la app."
        action={<Badge color="info">dev only</Badge>}
      />

      {/* ── Tokens ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Tokens de color</h2>
        <div className="flex flex-wrap gap-3">
          {[
            ["--color-primary",          "primary"       ],
            ["--color-surface",          "surface"       ],
            ["--color-surface-muted",    "surface-muted" ],
            ["--color-border",           "border"        ],
            ["--color-success-bg",       "success-bg"    ],
            ["--color-warning-bg",       "warning-bg"    ],
            ["--color-error-bg",         "error-bg"      ],
            ["--color-info-bg",          "info-bg"       ],
            ["--color-danger",           "danger"        ],
          ].map(([token, label]) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <div
                className="h-10 w-16 rounded-[var(--radius)] border border-[var(--color-border)]"
                style={{ background: `var(${token})` }}
              />
              <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Botones ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Botones</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary"   type="button">Primary</Button>
          <Button variant="secondary" type="button">Secondary</Button>
          <Button variant="ghost"     type="button">Ghost</Button>
          <Button variant="danger"    type="button">Danger</Button>
          <Button variant="primary"   type="button" disabled>Disabled</Button>
        </div>
      </Card>

      {/* ── Badges ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge color="default">Borrador</Badge>
          <Badge color="success">Aceptado</Badge>
          <Badge color="warning">Enviado</Badge>
          <Badge color="danger">Rechazado</Badge>
          <Badge color="info">Información</Badge>
        </div>
      </Card>

      {/* ── Notices ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Notices</h2>
        <div className="space-y-2">
          <Notice info="Operación completada exitosamente." />
          <Notice error="Ocurrió un error. Inténtalo de nuevo." />
        </div>
      </Card>

      {/* ── Inputs ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Inputs</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campo de texto" name="demo_text" placeholder="Escribe aquí…" />
          <Field label="Correo" name="demo_email" type="email" placeholder="tu@correo.com" />
          <Field label="Campo opcional" name="demo_opt" required={false} hint="Este campo no es obligatorio." />
          <Select
            label="Selección"
            name="demo_select"
            options={[
              { value: "a", label: "Opción A" },
              { value: "b", label: "Opción B" },
              { value: "c", label: "Opción C" },
            ]}
          />
          <div className="sm:col-span-2">
            <Textarea label="Área de texto" name="demo_textarea" placeholder="Notas adicionales…" required={false} />
          </div>
        </div>
      </Card>

      {/* ── Tabs ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Tabs</h2>
        <Tabs tabs={sampleTabs} active="a" />
      </Card>

      {/* ── Stepper ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Stepper</h2>
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-xs text-[var(--color-text-muted)]">Paso 1 activo</p>
            <Stepper steps={sampleSteps} current={0} />
          </div>
          <div>
            <p className="mb-2 text-xs text-[var(--color-text-muted)]">Paso 2 activo (1 completado)</p>
            <Stepper steps={sampleSteps} current={1} />
          </div>
          <div>
            <p className="mb-2 text-xs text-[var(--color-text-muted)]">Todos completados</p>
            <Stepper steps={sampleSteps} current={3} />
          </div>
        </div>
      </Card>

      {/* ── PageHeader ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">PageHeader</h2>
        <PageHeader
          title="Título de página"
          subtitle="Subtítulo o descripción breve de la sección."
          action={<Button variant="primary" type="button">+ Crear</Button>}
        />
      </Card>

      {/* ── Tabla ── */}
      <Card className="p-0">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Tabla</h2>
        </div>
        <Table cols={["Número", "Cliente", "Total", "Estado"]}>
          <Tr href="#">
            <Td><span className="font-medium text-[var(--color-text-link)]">COT-000001</span></Td>
            <Td>Cliente Ejemplo S.A.</Td>
            <Td>USD 1,250.00</Td>
            <Td><Badge color="success">Aceptado</Badge></Td>
          </Tr>
          <Tr href="#">
            <Td><span className="font-medium text-[var(--color-text-link)]">COT-000002</span></Td>
            <Td>Importadora del Norte</Td>
            <Td>USD 3,400.00</Td>
            <Td><Badge color="warning">Enviado</Badge></Td>
          </Tr>
        </Table>
      </Card>

      {/* ── EmptyState ── */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">EmptyState</h2>
        <EmptyState
          title="No hay cotizaciones todavía"
          description="Crea la primera cotización para un cliente y aparecerá aquí."
          action={{ label: "+ Nueva cotización", href: "#" }}
        />
      </Card>
    </div>
  );
}
