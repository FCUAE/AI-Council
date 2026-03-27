import { authFetch } from "./clerk-token";

export function trackEvent(event: string, metadata?: Record<string, unknown>) {
  authFetch("/api/track-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, metadata }),
  }).catch(() => {});
}
