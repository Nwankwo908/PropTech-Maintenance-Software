const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
])

export const MAX_INSPECTION_CAPTURE_BYTES = 10 * 1024 * 1024

export function sniffInspectionCaptureMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  if (bytes.length >= 12) {
    const brand = String.fromCharCode(...bytes.slice(4, 12))
    if (brand.startsWith("ftyp")) {
      const box = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase()
      if (box === "heic" || box === "heif" || box === "mif1" || box === "msf1") {
        return box === "heif" ? "image/heif" : "image/heic"
      }
    }
  }
  return null
}

export function resolveInspectionCaptureMime(
  bytes: Uint8Array,
  claimed: string,
): string | null {
  const sniffed = sniffInspectionCaptureMime(bytes)
  if (sniffed) return sniffed
  const normalized = claimed.trim().toLowerCase()
  if (ALLOWED.has(normalized)) return normalized
  return null
}

export function isAllowedInspectionCaptureMime(mime: string): boolean {
  return ALLOWED.has(mime.trim().toLowerCase())
}
