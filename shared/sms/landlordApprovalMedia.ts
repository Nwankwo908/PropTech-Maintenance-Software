/**
 * Resident photos and videos on the landlord approval text.
 * Documents stay off the text. Twilio-auth URLs are never forwarded.
 */
import {
  isProviderAuthMediaUrl,
  mediaKindFromRef,
  normalizeMediaRefs,
} from "./media.ts"

/** Twilio accepts at most 10 media URLs on one message. */
export const LANDLORD_APPROVAL_MEDIA_LIMIT = 10

export function residentMediaRefs(value: unknown): string[] {
  const refs: string[] = []
  for (const ref of normalizeMediaRefs(value)) {
    if (isProviderAuthMediaUrl(ref)) continue
    const kind = mediaKindFromRef(ref)
    if (kind !== "image" && kind !== "video") continue
    refs.push(ref)
    if (refs.length >= LANDLORD_APPROVAL_MEDIA_LIMIT) break
  }
  return refs
}

/** Line that goes on the text when the photo or video is attached. */
export function landlordApprovalMediaLine(refs: readonly string[]): string | null {
  return mediaLine(refs, true)
}

/** Line when the photo could not be attached and stays on the request. */
export function landlordApprovalMediaFallbackLine(refs: readonly string[]): string | null {
  return mediaLine(refs, false)
}

function mediaLine(refs: readonly string[], attached: boolean): string | null {
  if (refs.length === 0) return null
  const videos = refs.filter((ref) => mediaKindFromRef(ref) === "video").length
  const photos = refs.length - videos
  if (photos > 0 && videos > 0) {
    return attached
      ? "The resident sent photos and a video."
      : "The resident sent photos and a video. They are saved on the request."
  }
  if (videos > 0) {
    if (videos === 1) {
      return attached
        ? "The resident sent this video."
        : "The resident sent a video. It is saved on the request."
    }
    return attached
      ? "The resident sent these videos."
      : "The resident sent videos. They are saved on the request."
  }
  if (photos === 1) {
    return attached
      ? "The resident sent this photo."
      : "The resident sent a photo. It is saved on the request."
  }
  return attached
    ? "The resident sent these photos."
    : "The resident sent photos. They are saved on the request."
}
