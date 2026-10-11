import multer from "multer";
import { Request, Response, NextFunction } from "express";
import ErrorHandler from "../../utils/ErrorHandler";

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const DOCUMENT_MAX_PAGES = 150; // PDF pages read; the rest is ignored
export const DOCUMENT_MIN_CHARS = 300; // less than this is not enough to write questions from
export const DOCUMENT_TYPES = ["pdf", "docx", "txt", "md"];

export type DocumentKind = "pdf" | "docx" | "text";

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
});

/** Multer for one study document held in memory, in the multipart field "document". */
export const documentUploadMiddleware = (req: Request, res: Response, next: NextFunction) =>
  documentUpload.single("document")(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return next(
        new ErrorHandler("The document is too large (maximum 10MB)", 400, "DOCUMENT_TOO_LARGE")
      );
    }
    next(err);
  });

const unreadable = (message: string) => new ErrorHandler(message, 400, "DOCUMENT_UNREADABLE");

/**
 * The real type is read from the file bytes; the client-declared mimetype and filename
 * are never trusted.
 */
export function detectDocumentKind(buffer: Buffer): DocumentKind | undefined {
  if (buffer.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "docx"; // a zip container
  if (buffer.includes(0)) return undefined; // binary
  return "text";
}

async function pdfText(buffer: Buffer): Promise<string> {
  // Loaded on first use: the PDF engine is large and most requests never need it.
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Only text is read. Nothing in an uploaded file is ever evaluated or rendered.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, DOCUMENT_MAX_PAGES); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item: any) => (item.str || "") + (item.hasEOL ? "\n" : "")).join("")
      );
      page.cleanup();
    }
    return pages.join("\n\n");
  } catch (e: any) {
    if (e?.name === "PasswordException") {
      throw unreadable("The PDF is password protected. Remove the password and try again.");
    }
    throw unreadable("The PDF could not be read. Try saving it again or upload another file.");
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

async function docxText(buffer: Buffer): Promise<string> {
  const mammoth = require("mammoth") as typeof import("mammoth");
  try {
    return (await mammoth.extractRawText({ buffer })).value;
  } catch {
    throw new ErrorHandler(
      "Only PDF, Word (.docx) and plain text documents are supported",
      400,
      "INVALID_DOCUMENT_TYPE"
    );
  }
}

/** Tidies extracted text: one space between words, at most one blank line between blocks. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // soft hyphens
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pulls the readable text out of an uploaded PDF, Word or plain-text document. */
export async function extractDocumentText(
  buffer: Buffer
): Promise<{ kind: DocumentKind; text: string }> {
  if (!buffer || buffer.length === 0) {
    throw new ErrorHandler("A document is required", 400, "DOCUMENT_REQUIRED");
  }
  if (buffer.length > DOCUMENT_MAX_BYTES) {
    throw new ErrorHandler("The document is too large (maximum 10MB)", 400, "DOCUMENT_TOO_LARGE");
  }
  const kind = detectDocumentKind(buffer);
  if (!kind) {
    throw new ErrorHandler(
      "Only PDF, Word (.docx) and plain text documents are supported",
      400,
      "INVALID_DOCUMENT_TYPE"
    );
  }
  const raw =
    kind === "pdf"
      ? await pdfText(buffer)
      : kind === "docx"
        ? await docxText(buffer)
        : buffer.toString("utf8");
  const text = cleanText(raw);
  if (!text && kind === "pdf") {
    throw unreadable(
      "No text was found in the PDF. Scanned pages and photos cannot be read; upload a text PDF."
    );
  }
  return { kind, text };
}
