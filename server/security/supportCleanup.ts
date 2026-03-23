import fs from "fs";
import path from "path";
import { pool } from "../db";
import { ObjectStorageService } from "../replit_integrations/object_storage";

const RETENTION_DAYS = 30;
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

let objectStorageService: ObjectStorageService | null = null;

function getObjectStorageService(): ObjectStorageService {
  if (!objectStorageService) {
    objectStorageService = new ObjectStorageService();
  }
  return objectStorageService;
}

async function deleteFile(filename: string): Promise<"deleted" | "missing" | "error"> {
  const localPath = path.join(UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      return "deleted";
    }
  } catch {
    return "error";
  }

  try {
    const objService = getObjectStorageService();
    await objService.deleteObjectEntityFile(`/objects/${filename}`);
    return "deleted";
  } catch {
    return "missing";
  }
}

export async function cleanupOldSupportAttachments(): Promise<void> {
  const client = await pool.connect();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const result = await client.query(
      `SELECT id, filename FROM file_uploads WHERE purpose = 'support' AND created_at < $1`,
      [cutoff.toISOString()],
    );

    const rows = result.rows as { id: number; filename: string }[];
    if (rows.length === 0) {
      return;
    }

    let deleted = 0;
    let missing = 0;
    let errors = 0;

    for (const row of rows) {
      const fileResult = await deleteFile(row.filename);

      if (fileResult === "deleted" || fileResult === "missing") {
        try {
          await client.query(`DELETE FROM file_uploads WHERE id = $1`, [row.id]);
        } catch {
          errors++;
        }

        if (fileResult === "deleted") {
          deleted++;
        } else {
          missing++;
        }
      } else {
        errors++;
      }
    }

    console.log(
      `[SUPPORT CLEANUP] Processed ${rows.length} support attachment(s) older than ${RETENTION_DAYS} days: ${deleted} deleted, ${missing} already absent, ${errors} error(s)`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT CLEANUP] Failed:", msg);
  } finally {
    client.release();
  }
}

export function startSupportCleanupCron(): void {
  const interval = setInterval(
    () => {
      cleanupOldSupportAttachments().catch(() => {});
    },
    24 * 60 * 60 * 1000,
  );
  interval.unref();

  cleanupOldSupportAttachments().catch(() => {});
}
