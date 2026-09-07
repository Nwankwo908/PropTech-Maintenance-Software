import { sniffInspectionCaptureMime } from "../inspectionCapture/mime.ts"

const OPENAI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export function stripVisionDataUrl(imageBase64: string): string {
  return imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
}

function peekDecodedBytes(base64: string, count = 16): Uint8Array {
  const take = Math.min(base64.length, Math.ceil((count * 4) / 3) + 8)
  try {
    const bin = atob(base64.slice(0, take))
    const out = new Uint8Array(Math.min(count, bin.length))
    for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array()
  }
}

/**
 * OpenAI vision accepts JPEG/PNG/WEBP/GIF only.
 * Returns a supported MIME or null when the bytes are HEIC/unknown.
 */
export function resolveOpenAiVisionMediaType(
  imageBase64: string,
  claimed?: string,
): { mediaType: string } | { error: string } {
  const raw = stripVisionDataUrl(imageBase64)
  if (!raw) return { error: "Photo data was empty." }

  const sniffed = sniffInspectionCaptureMime(peekDecodedBytes(raw, 16))
  if (sniffed && OPENAI_IMAGE_TYPES.has(sniffed)) {
    return { mediaType: sniffed }
  }
  if (sniffed === "image/heic" || sniffed === "image/heif") {
    return {
      error:
        "This photo is in HEIC format, which AI scan cannot read. Save or export it as JPG or PNG and try again.",
    }
  }

  const claimedType = (claimed ?? "").trim().toLowerCase()
  if (OPENAI_IMAGE_TYPES.has(claimedType)) return { mediaType: claimedType }
  if (claimedType === "image/heic" || claimedType === "image/heif") {
    return {
      error:
        "This photo is in HEIC format, which AI scan cannot read. Save or export it as JPG or PNG and try again.",
    }
  }
  if (claimedType === "application/pdf") {
    return { mediaType: "application/pdf" }
  }
  return { mediaType: "image/jpeg" }
}
