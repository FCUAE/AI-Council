import path from "path";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { securityLog } from "../securityLogger";
import { ObjectStorageService, ObjectPermission } from "../replit_integrations/object_storage";

const objectStorageService = new ObjectStorageService();

export class AttachmentAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public reason: string
  ) {
    super(message);
    this.name = "AttachmentAuthError";
  }
}

export function normalizeAttachmentUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new AttachmentAuthError(400, "Invalid attachment URL", "empty_url");
  }

  const trimmed = rawUrl.trim();

  let pathPart: string;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      pathPart = decodeURIComponent(parsed.pathname).replace(/\/+/g, "/");
    } catch {
      throw new AttachmentAuthError(400, "Invalid attachment URL", "malformed_url");
    }
  } else {
    let urlStr = trimmed;

    try {
      urlStr = decodeURIComponent(urlStr);
    } catch {
    }

    const hashIdx = urlStr.indexOf("#");
    if (hashIdx !== -1) {
      urlStr = urlStr.slice(0, hashIdx);
    }

    const qIdx = urlStr.indexOf("?");
    if (qIdx !== -1) {
      urlStr = urlStr.slice(0, qIdx);
    }

    urlStr = urlStr.replace(/\/+/g, "/");
    pathPart = urlStr;
  }

  const segments = pathPart.split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  const normalized = "/" + resolved.join("/");

  if (normalized.includes("..") || normalized.includes("\0")) {
    throw new AttachmentAuthError(400, "Invalid attachment URL", "traversal_attempt");
  }

  return normalized;
}

function isUrlSafeForFetch(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    const allowed: string[] = [];
    if (process.env.REPLIT_DOMAINS) {
      allowed.push(
        ...process.env.REPLIT_DOMAINS.split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      );
    }
    if (process.env.REPLIT_DEV_DOMAIN) {
      allowed.push(process.env.REPLIT_DEV_DOMAIN);
    }
    allowed.push("storage.googleapis.com");
    return allowed.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function validateAttachmentAccess(
  userId: string,
  rawUrl: string,
  isAdmin: boolean
): Promise<void> {
  const normalized = normalizeAttachmentUrl(rawUrl);

  if (normalized.startsWith("/uploads/")) {
    const filename = path.basename(normalized);
    if (!filename || filename === "." || filename === "..") {
      throw new AttachmentAuthError(400, "Invalid attachment URL", "invalid_filename");
    }

    const ownerResult = await db.execute(
      sql`SELECT user_id FROM file_uploads WHERE filename = ${filename}`
    );
    const ownerRows = ownerResult.rows as { user_id: string }[];
    const ownerRow = ownerRows[0];

    if (!ownerRow) {
      throw new AttachmentAuthError(403, "Access denied", "no_ownership_record");
    }

    if (!isAdmin && ownerRow.user_id !== userId) {
      throw new AttachmentAuthError(403, "Access denied", "not_owner");
    }

    return;
  }

  if (normalized.startsWith("/objects/")) {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(normalized);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        throw new AttachmentAuthError(403, "Access denied", "acl_denied");
      }
    } catch (err: any) {
      if (err instanceof AttachmentAuthError) throw err;
      throw new AttachmentAuthError(403, "Access denied", "object_storage_error");
    }
    return;
  }

  const originalUrl = rawUrl.trim();
  if (originalUrl.startsWith("http://") || originalUrl.startsWith("https://")) {
    if (!isUrlSafeForFetch(originalUrl)) {
      throw new AttachmentAuthError(400, "Unsafe external URL", "unsafe_external_url");
    }
    return;
  }

  throw new AttachmentAuthError(400, "Invalid attachment URL", "unknown_url_pattern");
}

interface AttachmentLike {
  url: string;
  name?: string;
  type?: string;
  size?: number;
}

export async function validateAttachmentsBatch(
  userId: string,
  attachments: AttachmentLike[],
  isAdmin: boolean
): Promise<void> {
  for (const att of attachments) {
    try {
      await validateAttachmentAccess(userId, att.url, isAdmin);
    } catch (err: any) {
      const reason = err instanceof AttachmentAuthError ? err.reason : "unknown";
      securityLog.fileAccessDenied({
        route: "attachment_validation",
        userId,
        reason: `attachment_auth_${reason}`,
      });
      throw err;
    }
  }
}
