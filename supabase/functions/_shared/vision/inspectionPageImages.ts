/** Max PDF pages sent to GPT-4o for an inspection report (cover + 4-point form). */
export const INSPECTION_REPORT_MAX_PAGES = 8

export type InspectionPageImage = {
  base64: string
  mediaType: string
}

function stripDataUrl(base64: string): string {
  return base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").trim()
}

/** Parse client-rasterized report pages. Edge Deno has no OffscreenCanvas. */
export function parseInspectionPageImages(raw: unknown): InspectionPageImage[] {
  if (!Array.isArray(raw)) return []
  const pages: InspectionPageImage[] = []
  for (const row of raw.slice(0, INSPECTION_REPORT_MAX_PAGES)) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const base64 = typeof record.base64 === "string" ? stripDataUrl(record.base64) : ""
    if (!base64) continue
    const claimed = typeof record.mediaType === "string" ? record.mediaType.trim().toLowerCase() : ""
    const mediaType = claimed.startsWith("image/") ? claimed : "image/jpeg"
    pages.push({ base64, mediaType })
  }
  return pages
}

/** Parse optional PDF text-layer strings from the browser (index-aligned with page images). */
export function parseInspectionPageTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, INSPECTION_REPORT_MAX_PAGES).map((row) => {
    if (typeof row !== "string") return ""
    return row.replace(/\s+/g, " ").trim().slice(0, 4000)
  })
}

export function formatInspectionPageTextsForPrompt(
  texts: string[],
  range?: { pageStart: number; pageEnd: number },
): string {
  const start = range ? Math.max(0, range.pageStart - 1) : 0
  const end = range ? Math.max(start, range.pageEnd) : texts.length
  const slice = texts.slice(start, end)
  if (slice.every((text) => !text)) return ""
  return slice
    .map((text, index) => {
      const page = start + index + 1
      return text ? `--- Page ${page} text ---\n${text}` : ""
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 16000)
}
