import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";

const MAX_TEXT_LENGTH = 200000;

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      console.error(`[documentParser] File not found: ${filePath}`);
      return null;
    }

    let text: string | null = null;

    if (mimeType === "application/pdf") {
      text = await extractPdfText(filePath);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      text = await extractDocxText(filePath);
    } else if (isPlainTextType(mimeType)) {
      text = fs.readFileSync(filePath, "utf-8");
    }

    if (text && text.trim().length === 0) {
      return null;
    }

    if (text && text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + `\n\n[... Document truncated at ${MAX_TEXT_LENGTH} characters. The full document is ${text.length} characters long.]`;
    }

    return text;
  } catch (error) {
    console.error(`[documentParser] Failed to extract text from ${filePath}:`, error);
    return null;
  }
}

async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const fileBuffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(fileBuffer);
    const parser = new PDFParse(uint8);
    const result = await parser.getText();
    const text = result.text || "";
    const cleaned = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim();
    if (cleaned.length < 20) {
      return null;
    }
    return cleaned;
  } catch (error) {
    console.error("[documentParser] PDF extraction failed:", error);
    return null;
  }
}

async function extractDocxText(filePath: string): Promise<string | null> {
  try {
    const mammoth = await import("mammoth");
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value || null;
  } catch (error) {
    console.error("[documentParser] DOCX extraction failed:", error);
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

export function renderPdfToImages(filePath: string): string[] {
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const prefix = path.join(uploadsDir, `pdf-render-${randomUUID()}`);
    execFileSync("pdftoppm", ["-png", "-r", "150", "-l", String(MAX_PDF_PAGES), filePath, prefix], {
      timeout: 30000,
    });

    const dir = fs.readdirSync(uploadsDir);
    const baseName = path.basename(prefix);
    const rendered = dir
      .filter(f => f.startsWith(baseName) && f.endsWith(".png"))
      .sort()
      .map(f => path.join(uploadsDir, f));

    console.log(`[documentParser] Rendered ${rendered.length} page(s) from PDF as images`);
    return rendered;
  } catch (error) {
    console.error("[documentParser] PDF-to-image rendering failed:", error);
    return [];
  }
}

export async function getPdfPageCount(filePath: string): Promise<number> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const fileBuffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(fileBuffer);
    const parser = new PDFParse(uint8);
    const result = await parser.getText();
    return result.total || 0;
  } catch {
    return 0;
  }
}

export function cleanupRenderedImages(filePaths: string[]): void {
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp) && path.basename(fp).startsWith("pdf-render-")) {
        fs.unlinkSync(fp);
      }
    } catch {}
  }
}
