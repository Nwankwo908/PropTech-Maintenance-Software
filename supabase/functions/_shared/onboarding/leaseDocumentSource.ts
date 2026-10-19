import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import type { DocumentPart } from './documentProvider.ts'

/** Lossless page copies preserve scan resolution. Original page numbers stay
 * in the prompt; the selected PDF uses its own 1-based physical page order. */
export async function leaseDocumentParts(input: { bytes: Uint8Array; mimeType: string; pageTexts: string[]; pageImages?: string[] }, pages: number[]): Promise<DocumentPart[]> {
  const parts: DocumentPart[] = []
  if (input.mimeType === 'application/pdf' && input.bytes.length) {
    const original = await PDFDocument.load(input.bytes)
    const pdfPageCount = original.getPageCount()
    const all = pages.length === pdfPageCount && pages.every((page, i) => page === i + 1)
    if (all) parts.push({bytes:input.bytes,mimeType:'application/pdf'})
    else {
      const selected = await PDFDocument.create()
      const copied = await selected.copyPages(original, pages.map(page => page - 1))
      for (const page of copied) selected.addPage(page)
      parts.push({bytes:new Uint8Array(await selected.save()),mimeType:'application/pdf'})
    }
    parts.unshift({text:`This PDF contains original document pages ${pages.join(', ')} in that order. Cite ORIGINAL page numbers, not positions in this selected PDF.`})
  } else if (input.mimeType.startsWith('image/') && input.bytes.length) {
    parts.push({bytes:input.bytes,mimeType:input.mimeType,page:1})
  } else if (input.pageImages?.length) {
    for (const page of pages) {
      const image = input.pageImages[page-1]
      if (!image) continue
      const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!match) throw new Error('Use JPEG, PNG or WebP document page images.')
      parts.push({text:`Original document page ${page}`},{bytes:Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)),mimeType:match[1],page})
    }
  }
  for (const page of pages) if (input.pageTexts[page-1]?.trim()) parts.push({text:`Embedded text from ORIGINAL page ${page}:\n${input.pageTexts[page-1]}`})
  return parts
}
