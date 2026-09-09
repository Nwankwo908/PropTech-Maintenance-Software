/**
 * Shrink PDFs before GPT vision/file extract so large scans do not 429.
 */
import { PDFDocument } from "npm:pdf-lib@1.17.1"

export const MAX_RESPONSES_PDF_BYTES = 1_800_000
export const MAX_RESPONSES_PDF_PAGES = 8

export type ShrunkPdf = {
  bytes: Uint8Array
  pageCount: number
  usedPages: number
  pageNumbers: number[]
}

export async function shrinkPdfForExtract(
  bytes: Uint8Array,
  options?: { maxBytes?: number; maxPages?: number; pageNumbers?: number[] },
): Promise<ShrunkPdf> {
  const maxBytes = options?.maxBytes ?? MAX_RESPONSES_PDF_BYTES
  const maxPages = options?.maxPages ?? MAX_RESPONSES_PDF_PAGES

  let src: PDFDocument
  try {
    src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    return { bytes, pageCount: 1, usedPages: 1, pageNumbers: [1] }
  }

  const pageCount = Math.max(1, src.getPageCount())
  const requested = (options?.pageNumbers ?? [])
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
  const targetIndices =
    requested.length > 0
      ? requested.slice(0, maxPages).map((page) => page - 1)
      : Array.from({ length: Math.min(pageCount, maxPages) }, (_, i) => i)

  const needsSlice =
    targetIndices.length < pageCount ||
    bytes.length > maxBytes ||
    (requested.length > 0 && (requested[0] !== 1 || requested.length !== pageCount))
  if (!needsSlice) {
    return {
      bytes,
      pageCount,
      usedPages: pageCount,
      pageNumbers: Array.from({ length: pageCount }, (_, i) => i + 1),
    }
  }

  let used = targetIndices.length
  while (used >= 1) {
    const out = await PDFDocument.create()
    const indices = targetIndices.slice(0, used)
    const copied = await out.copyPages(src, indices)
    for (const page of copied) out.addPage(page)
    const saved = new Uint8Array(await out.save({ useObjectStreams: true }))
    if (saved.length <= maxBytes || used === 1) {
      return {
        bytes: saved,
        pageCount,
        usedPages: used,
        pageNumbers: indices.map((index) => index + 1),
      }
    }
    used -= 1
  }

  return {
    bytes,
    pageCount,
    usedPages: pageCount,
    pageNumbers: Array.from({ length: pageCount }, (_, i) => i + 1),
  }
}
