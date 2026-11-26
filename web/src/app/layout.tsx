import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Logística SaaS",
  description: "Gestión de embarques para agentes de carga",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[var(--color-surface-subtle)] text-[var(--color-text)] antialiased">{children}</body>
    </html>
  );
}
