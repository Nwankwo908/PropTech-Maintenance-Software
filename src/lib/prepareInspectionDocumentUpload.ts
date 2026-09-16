import { compressImageForVision } from '@/lib/imageCompress'
import { extractPdfPageTexts, renderPdfFileToJpegDataUrls } from '@/lib/pdfPageImagesBrowser'

export const INSPECTION_REPORT_CLIENT_MAX_PAGES = 8

export type InspectionUploadPageImage = {
  base64: string
  mediaType: string
}

/**
 * Prepare an inspection file for ingest.
 * PDFs stay PDFs in storage. Pages are rasterized in the browser because the
 * edge runtime cannot render PDFs (no OffscreenCanvas).
 */
export async function prepareInspectionDocumentUpload(file: File): Promise<{
  blob: Blob
  base64: string
  contentType: string
  fileName: string
  pageImages?: InspectionUploadPageImage[]
  pageTexts?: string[]
}> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    const urls = await renderPdfFileToJpegDataUrls(file, {
      maxPages: INSPECTION_REPORT_CLIENT_MAX_PAGES,
      maxEdge: 1100,
      quality: 0.55,
    })
    if (urls.length === 0) {
      throw new Error(
        "We couldn’t read this inspection report. Export the first page as a JPG and try again.",
      )
    }
    const pageTexts = await extractPdfPageTexts(file, INSPECTION_REPORT_CLIENT_MAX_PAGES)
    const stored = await compressImageForVision(file)
    return {
      ...stored,
      pageImages: urls.map((url) => ({
        base64: url.replace(/^data:image\/jpeg;base64,/, ''),
        mediaType: 'image/jpeg',
      })),
      pageTexts: pageTexts.map((text) => text.slice(0, 4000)),
    }
  }
  return compressImageForVision(file)
}
