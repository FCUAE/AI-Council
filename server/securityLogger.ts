type SecurityEventType =
  | "auth_collision_blocked"
  | "file_access_denied"
  | "destructive_action"
  | "admin_access"
  | "csrf_origin_mismatch"
  | "billing_anomaly"
  | "upload_validation_failure"
  | "rate_limit_hit";

interface SecurityEvent {
  event: SecurityEventType;
  [key: string]: unknown;
}

function redactId(id: string): string {
  if (!id || id.length < 8) return "***";
  return id.slice(0, 6) + "***";
}

function redactEmail(email: string): string {
  if (!email) return "***";
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return email[0] + "***@" + email.slice(at + 1);
}

function logSecurityEvent(event: SecurityEvent): void {
  const timestamp = new Date().toISOString();
  console.log(`[SECURITY] ${timestamp} ${JSON.stringify(event)}`);
}

export const securityLog = {
  authCollisionBlocked(data: { email: string; existingId: string; newId: string }) {
    logSecurityEvent({
      event: "auth_collision_blocked",
      email: redactEmail(data.email),
      existingIdPrefix: redactId(data.existingId),
      newIdPrefix: redactId(data.newId),
    });
  },

  fileAccessDenied(data: { route: string; userId?: string; reason: string }) {
    logSecurityEvent({
      event: "file_access_denied",
      route: data.route,
      userId: data.userId ? redactId(data.userId) : "anonymous",
      reason: data.reason,
    });
  },

  destructiveAction(data: { action: string; userId: string }) {
    logSecurityEvent({
      event: "destructive_action",
      action: data.action,
      userId: redactId(data.userId),
    });
  },

  adminAccess(data: { route: string; userId: string }) {
    logSecurityEvent({
      event: "admin_access",
      route: data.route,
      userId: redactId(data.userId),
    });
  },

  csrfOriginMismatch(data: { route: string; origin: string; method: string }) {
    logSecurityEvent({
      event: "csrf_origin_mismatch",
      route: data.route,
      origin: data.origin,
      method: data.method,
    });
  },

  billingAnomaly(data: { action: string; userId: string; detail: string }) {
    logSecurityEvent({
      event: "billing_anomaly",
      action: data.action,
      userId: redactId(data.userId),
      detail: data.detail,
    });
  },

  uploadValidationFailure(data: { reason: string; mimetype?: string; ext?: string }) {
    logSecurityEvent({
      event: "upload_validation_failure",
      reason: data.reason,
      mimetype: data.mimetype || "unknown",
      ext: data.ext || "unknown",
    });
  },

  rateLimitHit(data: { route: string; userId?: string }) {
    logSecurityEvent({
      event: "rate_limit_hit",
      route: data.route,
      userId: data.userId ? redactId(data.userId) : "ip-limited",
    });
  },
};
