import * as Sentry from "@sentry/nextjs";

const SENSITIVE_KEYS = ["password", "token", "secret", "key", "authorization", "cookie"];

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  beforeSend(event) {
    if (event.request?.data && typeof event.request.data === "object") {
      const data = event.request.data as Record<string, unknown>;
      for (const key of SENSITIVE_KEYS) {
        if (key in data) data[key] = "[Filtered]";
      }
    }
    return event;
  },
});
