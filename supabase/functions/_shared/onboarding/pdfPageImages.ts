/**
 * Rasterize PDF pages to JPEGs for Chat Completions vision (same path as photo uploads).
 */
import { getDocumentProxy } from "npm:unpdf@1.4.0"

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function pdfPagesToJpegDataUrls(
  bytes: Uint8Array,
  options?: { maxPages?: number; maxEdge?: number; quality?: number; pageNumbers?: number[] },
): Promise<string[]> {
  if (typeof OffscreenCanvas === "undefined") {
    console.warn("[onboarding-extract] OffscreenCanvas is not available")
    return []
  }

  const pdf = await getDocumentProxy(bytes.slice())
  const pageCount = Number(pdf.numPages) || 1
  const requested = (options?.pageNumbers ?? [])
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
  const fallbackCount = Math.min(pageCount, options?.maxPages ?? 3)
  const pageNumbers =
    requested.length > 0
      ? requested.slice(0, options?.maxPages ?? requested.length)
      : Array.from({ length: fallbackCount }, (_, i) => i + 1)
  const maxEdge = options?.maxEdge ?? 1280
  const quality = options?.quality ?? 0.62
  const urls: string[] = []

  for (const pageNumber of pageNumbers) {
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const longest = Math.max(base.width, base.height) || 1
    const scale = Math.min(maxEdge / longest, 1.4)
    const viewport = page.getViewport({ scale: Math.max(scale, 0.45) })
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext("2d")
    if (!context) return []
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality })
    const buffer = new Uint8Array(await blob.arrayBuffer())
    if (buffer.length === 0) continue
    urls.push(`data:image/jpeg;base64,${bytesToBase64(buffer)}`)
  }

  return urls
}
