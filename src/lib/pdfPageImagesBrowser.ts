import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorker

export const ONBOARDING_PDF_RENDER_MAX_PAGES = 2
export const ONBOARDING_PDF_RENDER_MAX_EDGE = 1100

function isPdfFileName(fileName: string, contentType?: string | null): boolean {
  if (fileName.toLowerCase().endsWith('.pdf')) return true
  const type = (contentType ?? '').toLowerCase()
  return type === 'application/pdf' || type === 'application/x-pdf'
}

export async function extractPdfPageTexts(
  file: File,
  maxPages = 150,
): Promise<string[]> {
  if (!isPdfFileName(file.name, file.type)) return []
  const data = new Uint8Array(await file.arrayBuffer()).slice()
  const pdf = await getDocument({ data, disableWorker: false }).promise
  const pageCount = Math.min(pdf.numPages, maxPages)
  const texts: string[] = []
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = Array.isArray(content.items) ? content.items : []
    const text = items
      .map((item) => {
        const str = (item as { str?: unknown }).str
        return typeof str === 'string' ? str : ''
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    texts.push(text)
  }
  return texts
}

/** Render scanned PDF pages in the browser so extract can use the photo path. */
export async function renderPdfFileToJpegDataUrls(
  file: File,
  options?: { maxPages?: number; maxEdge?: number; quality?: number; pageNumbers?: number[] },
): Promise<string[]> {
  if (!isPdfFileName(file.name, file.type)) return []
  if (typeof document === 'undefined') return []

  const data = new Uint8Array(await file.arrayBuffer()).slice()
  const pdf = await getDocument({ data, disableWorker: false }).promise
  const pageCount = pdf.numPages
  const requested = (options?.pageNumbers ?? []).filter(
    (page) => Number.isInteger(page) && page >= 1 && page <= pageCount,
  )
  const fallbackCount = Math.min(pageCount, options?.maxPages ?? ONBOARDING_PDF_RENDER_MAX_PAGES)
  const pageNumbers =
    requested.length > 0
      ? requested.slice(0, options?.maxPages ?? requested.length)
      : Array.from({ length: fallbackCount }, (_, i) => i + 1)
  const maxEdge = options?.maxEdge ?? ONBOARDING_PDF_RENDER_MAX_EDGE
  const quality = options?.quality ?? 0.58
  const urls: string[] = []

  for (const pageNumber of pageNumbers) {
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const longest = Math.max(base.width, base.height) || 1
    const scale = Math.min(maxEdge / longest, 1.35)
    const viewport = page.getViewport({ scale: Math.max(scale, 0.4) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) break
    await page.render({ canvas, viewport }).promise
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.startsWith('data:image/jpeg')) urls.push(url)
  }

  return urls
}
