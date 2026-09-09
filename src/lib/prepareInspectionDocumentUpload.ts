import { compressImageForVision } from '@/lib/imageCompress'
import { renderPdfFileToJpegDataUrls } from '@/lib/pdfPageImagesBrowser'

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',', 2)
  const mime = header?.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const binary = atob(data ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * Inspection GPT vision cannot read PDF `image_url` parts. Render cover pages
 * to JPEG in the browser first (same approach as Fast Track extract).
 */
export async function prepareInspectionDocumentUpload(file: File): Promise<{
  blob: Blob
  base64: string
  contentType: string
  fileName: string
}> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    try {
      const urls = await renderPdfFileToJpegDataUrls(file, {
        maxPages: 2,
        maxEdge: 1400,
        quality: 0.7,
      })
      const first = urls[0]
      if (first?.startsWith('data:image/jpeg')) {
        const base64 = first.replace(/^data:image\/jpeg;base64,/, '')
        return {
          blob: dataUrlToBlob(first),
          base64,
          contentType: 'image/jpeg',
          fileName: file.name.replace(/\.pdf$/i, '.jpg'),
        }
      }
    } catch {
      // Fall through to the original PDF; the edge function may still rasterize.
    }
  }
  return compressImageForVision(file)
}
