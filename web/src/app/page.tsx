export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold">Logística SaaS</h1>
      <p className="text-[var(--color-text-muted)]">
        Cada empresa entra por su propio subdominio, por ejemplo <code className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5">miempresa.tu-producto.com</code>.
      </p>
      <a href="/admin" className="text-sm font-medium text-[var(--color-text-link)] hover:underline">Panel de administración</a>
    </main>
  );
}
