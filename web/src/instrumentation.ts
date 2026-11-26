export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    await import("./lib/env"); // valida variables de entorno al arrancar
  }
}

// Captura errores de peticiones server-side y los envía a Sentry.
export const onRequestError = async (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
