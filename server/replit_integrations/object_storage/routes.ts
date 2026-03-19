import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { isAuthenticated } from "../auth";
import { randomUUID } from "crypto";
import { getAuth } from "@clerk/express";
import { pool } from "../../db";
import { securityLog } from "../../securityLogger";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const ALLOWED_UPLOAD_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf", "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAGIC_BYTES: Record<string, number[][]> = {
  "image/png": [[0x89, 0x50, 0x4E, 0x47]],
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
  "application/msword": [[0xD0, 0xCF, 0x11, 0xE0]],
};

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".js", ".jsx", ".ts", ".tsx", ".vbs", ".wsf", ".wsh",
  ".sh", ".bash", ".csh", ".ksh", ".zsh",
  ".html", ".htm", ".xhtml", ".svg", ".svgz",
  ".php", ".asp", ".aspx", ".jsp", ".py", ".rb", ".pl",
  ".dll", ".so", ".dylib",
]);

function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const signatures = MAGIC_BYTES[mimetype];
  if (!signatures) {
    if (mimetype === "text/plain") {
      for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
        const byte = buffer[i];
        if (byte === 0) return false;
      }
      return true;
    }
    return true;
  }
  return signatures.some(sig =>
    sig.every((byte, idx) => idx < buffer.length && buffer[idx] === byte)
  );
}

function hasSuspiciousFilename(filename: string): boolean {
  if (/[\x00-\x1F]/.test(filename)) return true;
  if (filename.includes('\0')) return true;
  const base = path.basename(filename);
  const parts = base.split('.');
  if (parts.length > 2) {
    const exts = parts.slice(1).map(p => '.' + p.toLowerCase());
    if (exts.some(e => BLOCKED_EXTENSIONS.has(e))) return true;
  }
  return false;
}

function validateUploadedFile(file: Express.Multer.File): string | null {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `Blocked file extension: ${ext}`;
  }
  if (hasSuspiciousFilename(file.originalname)) {
    return "Suspicious filename detected";
  }
  const buffer = fs.readFileSync(file.path);
  if (!validateMagicBytes(buffer, file.mimetype)) {
    return "File content does not match declared type";
  }
  return null;
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Supported: images, PDFs, text, and Word documents."));
    }
  },
});

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const supportUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG, JPG, GIF, and WebP images are allowed"));
    }
  },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again shortly." },
});

const supportUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again shortly." },
});

function getUserId(req: Request): string | null {
  try {
    const auth = getAuth(req);
    return auth?.userId || null;
  } catch {
    return null;
  }
}

function isAdmin(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return adminIds.includes(userId);
}

async function recordFileUpload(filename: string, userId: string, purpose: string): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO file_uploads (filename, user_id, purpose) VALUES ($1, $2, $3) ON CONFLICT (filename) DO NOTHING',
        [filename, userId, purpose]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[file_uploads] Failed to record upload:', err);
  }
}

async function getFileOwner(filename: string): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT user_id FROM file_uploads WHERE filename = $1', [filename]);
      return result.rows[0]?.user_id || null;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  app.post("/api/uploads/direct", uploadLimiter, isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const validationError = validateUploadedFile(req.file);
      if (validationError) {
        fs.unlink(req.file.path, () => {});
        securityLog.uploadValidationFailure({
          reason: validationError,
          mimetype: req.file.mimetype,
          ext: path.extname(req.file.originalname),
        });
        return res.status(400).json({ error: "File validation failed. Please upload a valid file." });
      }

      const userId = getUserId(req);
      if (userId) {
        await recordFileUpload(req.file.filename, userId, 'debate');
      }

      const objectPath = `/uploads/${req.file.filename}`;

      res.json({
        objectPath,
        metadata: {
          name: req.file.originalname,
          size: req.file.size,
          contentType: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  app.post("/api/support/upload", supportUploadLimiter, isAuthenticated, (req, res) => {
    supportUpload.single("file")(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "Image must be under 5 MB" });
          }
          return res.status(400).json({ error: err.message });
        }
        return res.status(400).json({ error: err.message || "Invalid file" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const validationError = validateUploadedFile(req.file);
      if (validationError) {
        fs.unlink(req.file.path, () => {});
        securityLog.uploadValidationFailure({
          reason: validationError,
          mimetype: req.file.mimetype,
          ext: path.extname(req.file.originalname),
        });
        return res.status(400).json({ error: "File validation failed." });
      }

      const userId = getUserId(req);
      if (userId) {
        await recordFileUpload(req.file.filename, userId, 'support');
      }

      const objectPath = `/uploads/${req.file.filename}`;

      res.json({
        objectPath,
        metadata: {
          name: req.file.originalname,
          size: req.file.size,
          contentType: req.file.mimetype,
        },
      });
    });
  });

  const SAFE_INLINE_TYPES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);

  app.get("/uploads/:filename", async (req, res) => {
    const rawFilename = req.params.filename;
    const sanitizedFilename = path.basename(rawFilename);
    const filePath = path.resolve(UPLOADS_DIR, sanitizedFilename);

    if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const userId = getUserId(req);
    const owner = await getFileOwner(sanitizedFilename);

    if (!userId) {
      securityLog.fileAccessDenied({ route: "/uploads", reason: "unauthenticated" });
      return res.status(403).json({ error: "Access denied" });
    }

    if (!isAdmin(userId)) {
      if (!owner) {
        securityLog.fileAccessDenied({ route: "/uploads", userId, reason: "no_ownership_record" });
        return res.status(403).json({ error: "Access denied" });
      }
      if (owner !== userId) {
        securityLog.fileAccessDenied({ route: "/uploads", userId, reason: "not_owner" });
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    const contentType = mimeTypes[ext] || "application/octet-stream";
    const disposition = SAFE_INLINE_TYPES.has(ext) ? "inline" : "attachment";

    res.set("Content-Type", contentType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Disposition", `${disposition}; filename="${sanitizedFilename}"`);
    res.set("Cache-Control", "private, no-store");
    res.sendFile(filePath);
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const userId = getUserId(req) || undefined;
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });

      if (!canAccess) {
        securityLog.fileAccessDenied({ route: "/objects", userId, reason: "acl_denied" });
        return res.status(403).json({ error: "Access denied" });
      }

      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(403).json({ error: "Access denied" });
      }
      console.error("Error serving object:", error);
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
