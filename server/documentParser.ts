import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { randomUUID } from "crypto";

const MAX_TEXT_LENGTH = 200000;
const PARSE_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

async function validateFilePath(filePath: string): Promise<string | null> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) {
    console.error(`[documentParser] Path traversal blocked`);
    return null;
  }
  try {
    const real = await fs.realpath(resolved);
    if (!real.startsWith(UPLOADS_DIR + path.sep) && real !== UPLOADS_DIR) {
      console.error(`[documentParser] Symlink escape blocked`);
      return null;
    }
    return real;
  } catch {
    return resolved;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const safePath = await validateFilePath(filePath);
    if (!safePath) return null;

    try {
      await fs.access(safePath);
    } catch {
      console.error(`[documentParser] File not found: ${safePath}`);
      return null;
    }

    const stat = await fs.stat(safePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.error(`[documentParser] File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE_BYTES})`);
      return null;
    }

    let text: string | null = null;

    if (mimeType === "application/pdf") {
      text = await withTimeout(extractPdfText(safePath), PARSE_TIMEOUT_MS, "PDF extraction");
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      text = await withTimeout(extractDocxText(safePath), PARSE_TIMEOUT_MS, "DOCX extraction");
    } else if (isPlainTextType(mimeType)) {
      text = await fs.readFile(safePath, "utf-8");
    }

    if (text && text.trim().length === 0) {
      return null;
    }

    if (text && text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + `\n\n[... Document truncated at ${MAX_TEXT_LENGTH} characters. The full document is ${text.length} characters long.]`;
    }

    return text;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown error";
      console.error(`[documentParser] Failed to extract text: ${msg}`);
    } else {
      console.error(`[documentParser] Failed to extract text from ${filePath}:`, error);
    }
    return null;
  }
}

async function checkFileSize(filePath: string, label: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.error(`[documentParser] ${label}: file too large (${stat.size} bytes, max ${MAX_FILE_SIZE_BYTES})`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    if (!(await checkFileSize(filePath, "extractPdfText"))) return null;
    const { PDFParse } = await import("pdf-parse");
    const fileBuffer = await fs.readFile(filePath);
    const uint8 = new Uint8Array(fileBuffer);
    const parser = new PDFParse(uint8);
    const result = await parser.getText();
    const text = result.text || "";
    const cleaned = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim();
    if (cleaned.length < 20) {
      return null;
    }
    return cleaned;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown error";
      console.error("[documentParser] PDF extraction failed:", msg);
    } else {
      console.error("[documentParser] PDF extraction failed:", error);
    }
    return null;
  }
}

async function extractDocxText(filePath: string): Promise<string | null> {
  try {
    if (!(await checkFileSize(filePath, "extractDocxText"))) return null;
    const mammoth = await import("mammoth");
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value || null;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown error";
      console.error("[documentParser] DOCX extraction failed:", msg);
    } else {
      console.error("[documentParser] DOCX extraction failed:", error);
    }
    return null;
  }
}

function isPlainTextType(mimeType: string): boolean {
  const plainTypes = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "text/json",
    "text/x-markdown",
  ];
  return plainTypes.includes(mimeType) || mimeType.startsWith("text/");
}

const MAX_PDF_PAGES = 3;

function execFileAsync(cmd: string, args: string[], options: { timeout: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function renderPdfToImages(filePath: string): Promise<string[]> {
  try {
    const safePath = await validateFilePath(filePath);
    if (!safePath) return [];
    if (!(await checkFileSize(safePath, "renderPdfToImages"))) return [];

    try {
      await fs.access(UPLOADS_DIR);
    } catch {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
    }

    const prefix = path.join(UPLOADS_DIR, `pdf-render-${randomUUID()}`);
    await execFileAsync("pdftoppm", ["-png", "-r", "150", "-l", String(MAX_PDF_PAGES), safePath, prefix], {
      timeout: 30000,
    });

    const dir = await fs.readdir(UPLOADS_DIR);
    const baseName = path.basename(prefix);
    const rendered = dir
      .filter(f => f.startsWith(baseName) && f.endsWith(".png"))
      .sort()
      .map(f => path.join(UPLOADS_DIR, f));

    console.log(`[documentParser] Rendered ${rendered.length} page(s) from PDF as images`);
    return rendered;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown error";
      console.error("[documentParser] PDF-to-image rendering failed:", msg);
    } else {
      console.error("[documentParser] PDF-to-image rendering failed:", error);
    }
    return [];
  }
}

export async function getPdfPageCount(filePath: string): Promise<number> {
  try {
    const safePath = await validateFilePath(filePath);
    if (!safePath) return 0;
    if (!(await checkFileSize(safePath, "getPdfPageCount"))) return 0;
    const inner = async () => {
      const { PDFParse } = await import("pdf-parse");
      const fileBuffer = await fs.readFile(safePath);
      const uint8 = new Uint8Array(fileBuffer);
      const parser = new PDFParse(uint8);
      const result = await parser.getText();
      return result.total || 0;
    };
    return await withTimeout(inner(), PARSE_TIMEOUT_MS, "PDF page count");
  } catch {
    return 0;
  }
}

export async function cleanupRenderedImages(filePaths: string[]): Promise<void> {
  for (const fp of filePaths) {
    try {
      const safeFp = await validateFilePath(fp);
      if (safeFp && path.basename(safeFp).startsWith("pdf-render-")) {
        await fs.unlink(safeFp);
      }
    } catch {}
  }
}
