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

export async function pdfBytesToPageTexts(bytes: Uint8Array): Promise<string[]> {
  try {
    const pdf = await getDocumentProxy(bytes.slice())
    const extracted = await extractText(pdf, { mergePages: false })
    const pages = Array.isArray(extracted.text)
      ? extracted.text
      : typeof extracted.text === "string"
        ? [extracted.text]
        : []
    return pages.map((page) => String(page ?? "").replace(/\r\n/g, "\n").trim())
  } catch (error) {
    console.warn(
      "[onboarding-extract] pdf page text",
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

export async function pdfBytesToPlainText(bytes: Uint8Array): Promise<string> {
  const pages = await pdfBytesToPageTexts(bytes)
  return pages.join("\n\n").slice(0, PDF_TEXT_LIMIT)
}
