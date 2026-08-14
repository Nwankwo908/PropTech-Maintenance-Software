/**
 * Plain-text extraction from PDF uploads (text layer via unpdf / PDF.js).
 * Scanned image-only PDFs return empty text and should use the file/OCR path.
 */
import { extractText, getDocumentProxy } from "npm:unpdf@1.4.0"

export const PDF_TEXT_LIMIT = 120_000
export const MIN_PDF_TEXT_CHARS = 400

export function isPdfFile(fileName: string, contentType: string): boolean {
  if (fileName.toLowerCase().endsWith(".pdf")) return true
  const type = contentType.toLowerCase()
  return type === "application/pdf" || type === "application/x-pdf"
}

export async function pdfBytesToPlainText(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytes)
    const extracted = await extractText(pdf, { mergePages: true })
    const text = typeof extracted.text === "string"
      ? extracted.text
      : Array.isArray(extracted.text)
        ? extracted.text.join("\n\n")
        : ""
    return text.replace(/\r\n/g, "\n").trim().slice(0, PDF_TEXT_LIMIT)
  } catch (error) {
    console.warn(
      "[onboarding-extract] pdf text",
      error instanceof Error ? error.message : error,
    )
    return ""
  }
}
