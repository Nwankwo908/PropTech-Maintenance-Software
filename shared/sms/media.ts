/** Shared MMS helpers — kind detection, storage vs provider URLs, inbox preview. */

export type SmsMediaKind = 'image' | 'video'

export type SmsMediaItem = {
  url: string
  kind: SmsMediaKind
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|3gp|3gpp)(?:$|[?#])/i
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)(?:$|[?#])/i

export function normalizeMediaRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** Private storage object path (not a URL). */
export function isStorageMediaPath(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (isHttpUrl(v) || v.includes('://')) return false
  return true
}

/**
 * Twilio/Telnyx media URLs require HTTP Basic and must never be used in
 * `<img>` / `<video>` — the browser prompts for credentials.
 */
export function isProviderAuthMediaUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.includes('api.twilio.com') ||
    lower.includes('media.twilio.com') ||
    lower.includes('api.telnyx.com')
  )
}

export function mediaKindFromRef(ref: string): SmsMediaKind {
  const lower = ref.trim().toLowerCase()
  if (lower.includes('video/') || VIDEO_EXT.test(lower)) return 'video'
  if (lower.includes('image/') || IMAGE_EXT.test(lower)) return 'image'
  return 'image'
}

export function mediaKindFromContentType(contentType: string): SmsMediaKind | null {
  const ct = contentType.trim().toLowerCase()
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('image/')) return 'image'
  return null
}

/** Inbox / list preview when the latest SMS is media-only. */
export function inboxPreviewForSmsMessage(body: string, mediaUrls: unknown): string {
  const text = body.trim()
  if (text) return text
  const refs = normalizeMediaRefs(mediaUrls)
  if (refs.length === 0) return 'No messages yet.'
  const videoCount = refs.filter((ref) => mediaKindFromRef(ref) === 'video').length
  const imageCount = refs.length - videoCount
  if (videoCount > 0 && imageCount > 0) {
    return refs.length === 2 ? 'Sent a photo and a video' : 'Sent photos and video'
  }
  if (videoCount > 0) return videoCount === 1 ? 'Sent a video' : 'Sent videos'
  return imageCount === 1 ? 'Sent a photo' : 'Sent photos'
}
