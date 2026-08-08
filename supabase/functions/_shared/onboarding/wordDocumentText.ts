/**
 * Plain-text extraction from Word uploads (.docx via mammoth, legacy .doc via word-extractor).
 */
import mammoth from "npm:mammoth@1.8.0"
import WordExtractor from "npm:word-extractor@1.0.4"
import { Buffer } from "node:buffer"

export const WORD_TEXT_LIMIT = 120_000

export function isWordFile(fileName: string, contentType: string): boolean {
  const lower = fileName.toLowerCase()
  if (/\.(docx|doc)$/i.test(lower)) return true
  const type = contentType.toLowerCase()
  return (
    type === "application/msword" ||
    type.includes("wordprocessingml.document")
  )
}

function isLegacyDocFile(fileName: string, contentType: string): boolean {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".docx")) return false
  if (lower.endsWith(".doc")) return true
  return contentType.toLowerCase() === "application/msword"
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function truncateText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim().slice(0, WORD_TEXT_LIMIT)
}

export async function wordBytesToPlainText(
  bytes: Uint8Array,
  fileName: string,
  contentType = "",
): Promise<string> {
  if (bytes.length === 0) return ""

  try {
    if (isLegacyDocFile(fileName, contentType)) {
      const extractor = new WordExtractor()
      const extracted = await extractor.extract(Buffer.from(bytes))
      const body = await extracted.getBody()
      return truncateText(body ?? "")
    }

    const arrayBuffer = toArrayBuffer(bytes)
    const result = await mammoth.extractRawText({ arrayBuffer })
    return truncateText(result.value ?? "")
  } catch {
    return ""
  }
}
