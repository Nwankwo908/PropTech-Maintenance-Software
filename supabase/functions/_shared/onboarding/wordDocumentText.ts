/**
 * Plain-text extraction from Word uploads (.docx, legacy .doc, RTF saved as Word).
 */
import JSZip from "npm:jszip@3.10.1"

export const WORD_TEXT_LIMIT = 120_000
const WORD_IMAGE_LIMIT = 3

export type WordBinaryKind = "docx" | "doc" | "rtf" | "pdf" | "unknown"

export function isWordFile(fileName: string, contentType: string): boolean {
  const lower = fileName.toLowerCase()
  if (/\.(docx|doc|rtf)$/i.test(lower)) return true
  const type = contentType.toLowerCase()
  return (
    type === "application/msword" ||
    type === "application/rtf" ||
    type === "text/rtf" ||
    type.includes("wordprocessingml.document")
  )
}

export function detectWordBinaryKind(bytes: Uint8Array): WordBinaryKind {
  if (bytes.length < 5) return "unknown"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return "docx"
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return "doc"
  }
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 64)).replace(/^\uFEFF/, "").trimStart()
  if (head.startsWith("{\\rtf")) return "rtf"
  return "unknown"
}

function truncateText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim().slice(0, WORD_TEXT_LIMIT)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : ""
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCharCode(code) : ""
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function wordXmlToPlainText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/gi, "\t")
    .replace(/<w:br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return truncateText(decodeXmlEntities(withBreaks).replace(/\n{3,}/g, "\n\n"))
}

export function rtfToPlainText(rtf: string): string {
  let text = rtf.replace(/^\uFEFF/, "")
  text = text.replace(/\{\\\*\\[^{}]*\}/g, " ")
  text = text.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer)[\s\S]*?\}/gi, " ")
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, (match) =>
    String.fromCharCode(Number.parseInt(match.slice(2), 16)),
  )
  text = text.replace(/\\par[d]?/gi, "\n")
  text = text.replace(/\\tab/gi, "\t")
  text = text.replace(/\\line/gi, "\n")
  text = text.replace(/\\[a-z]+\-?\d* ?/gi, "")
  text = text.replace(/[{}]/g, "")
  return truncateText(text.replace(/\n{3,}/g, "\n\n"))
}

function mimeForImageName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function docxZipToPlainText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const parts: string[] = []
  const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    if (!/(^|\/)word\/(document|header\d*|footer\d*)\.xml$/i.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    const xml = await file.async("string")
    const text = wordXmlToPlainText(xml)
    if (text) parts.push(text)
  }
  return truncateText(parts.join("\n"))
}

export async function wordBytesToImageDataUrls(
  bytes: Uint8Array,
  limit = WORD_IMAGE_LIMIT,
): Promise<string[]> {
  if (detectWordBinaryKind(bytes) !== "docx") return []
  try {
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files)
      .filter((name) => /^word\/media\//i.test(name) && /\.(png|jpe?g|gif|webp)$/i.test(name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, Math.max(1, limit))
    const urls: string[] = []
    for (const name of names) {
      const file = zip.file(name)
      if (!file) continue
      const content = await file.async("uint8array")
      if (content.length < 32) continue
      urls.push(`data:${mimeForImageName(name)};base64,${bytesToBase64(content)}`)
    }
    return urls
  } catch (error) {
    console.warn(
      "[onboarding-extract] word media",
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const [{ default: mammoth }, { Buffer }] = await Promise.all([
      import("npm:mammoth@1.8.0"),
      import("node:buffer"),
    ])
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    const fromMammoth = truncateText(result.value ?? "")
    if (fromMammoth) return fromMammoth
  } catch (error) {
    console.warn(
      "[onboarding-extract] mammoth",
      error instanceof Error ? error.message : error,
    )
  }
  try {
    return await docxZipToPlainText(bytes)
  } catch (error) {
    console.warn(
      "[onboarding-extract] docx zip",
      error instanceof Error ? error.message : error,
    )
    return ""
  }
}

async function extractLegacyDocText(bytes: Uint8Array): Promise<string> {
  try {
    const [{ default: WordExtractor }, { Buffer }] = await Promise.all([
      import("npm:word-extractor@1.0.4"),
      import("node:buffer"),
    ])
    const extractor = new WordExtractor()
    const extracted = await extractor.extract(Buffer.from(bytes))
    const body = await extracted.getBody()
    return truncateText(body ?? "")
  } catch (error) {
    console.warn(
      "[onboarding-extract] word-extractor",
      error instanceof Error ? error.message : error,
    )
    return ""
  }
}

export async function wordBytesToPlainText(
  bytes: Uint8Array,
  fileName: string,
  contentType = "",
): Promise<string> {
  if (bytes.length === 0) return ""
  const kind = detectWordBinaryKind(bytes)
  if (kind === "pdf") return ""
  if (kind === "rtf" || fileName.toLowerCase().endsWith(".rtf") || /rtf/i.test(contentType)) {
    return rtfToPlainText(new TextDecoder("latin1").decode(bytes))
  }
  if (kind === "doc") {
    const fromOle = await extractLegacyDocText(bytes)
    if (fromOle) return fromOle
  }
  if (kind === "docx") {
    return await extractDocxText(bytes)
  }
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".docx") || contentType.toLowerCase().includes("wordprocessingml")) {
    return await extractDocxText(bytes)
  }
  if (lower.endsWith(".doc") || contentType.toLowerCase() === "application/msword") {
    return await extractLegacyDocText(bytes)
  }
  const asRtf = rtfToPlainText(new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 20_000))))
  return asRtf.length > 20 ? asRtf : ""
}
