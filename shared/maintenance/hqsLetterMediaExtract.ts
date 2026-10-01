/**
 * HQS letter text acquisition routes.
 *
 * PDF → extract text directly (no vision).
 * Photo → explicit vision OCR step (must NOT use the old rehost-only no-op).
 */
import {
  mediaKindFromContentType,
  mediaKindFromRef,
  type SmsMediaKind,
} from '../sms/media.ts'
import { extractHqsInspectionLetter, type HqsLetterExtraction } from './hqsInspectionLetter.ts'

export type HqsLetterMediaRoute = "pdf_text" | "vision_ocr" | "unsupported"

export function resolveHqsLetterMediaRoute(input: {
  contentType?: string | null
  storagePathOrUrl?: string | null
}): HqsLetterMediaRoute {
  const fromCt = input.contentType
    ? mediaKindFromContentType(input.contentType)
    : null
  const kind: SmsMediaKind | null =
    fromCt ??
    (input.storagePathOrUrl ? mediaKindFromRef(input.storagePathOrUrl) : null)
  if (kind === "document") return "pdf_text"
  if (kind === "image") return "vision_ocr"
  return "unsupported"
}

/**
 * Vision OCR for photographed HQS letters.
 * Pure entry used by tests with injected OCR text; live callers pass a real
 * `ocrImage` implementation (Gemini/GPT vision). Rehost-only is not enough.
 */
export async function extractHqsLetterViaVisionOcr(input: {
  /** Required — without this, photo attachments cannot be classified. */
  ocrImage: (args: { storagePathOrUrl: string; contentType?: string | null }) => Promise<string>
  storagePathOrUrl: string
  contentType?: string | null
}): Promise<{ route: "vision_ocr"; ocrText: string; extraction: HqsLetterExtraction }> {
  const route = resolveHqsLetterMediaRoute({
    contentType: input.contentType,
    storagePathOrUrl: input.storagePathOrUrl,
  })
  if (route !== "vision_ocr") {
    throw new Error(`extractHqsLetterViaVisionOcr requires vision_ocr route, got ${route}`)
  }
  const ocrText = await input.ocrImage({
    storagePathOrUrl: input.storagePathOrUrl,
    contentType: input.contentType,
  })
  return {
    route: "vision_ocr",
    ocrText,
    extraction: extractHqsInspectionLetter(ocrText),
  }
}

/** PDF text path — no vision. */
export function extractHqsLetterFromPdfText(pdfText: string): {
  route: "pdf_text"
  extraction: HqsLetterExtraction
} {
  return {
    route: "pdf_text",
    extraction: extractHqsInspectionLetter(pdfText),
  }
}
