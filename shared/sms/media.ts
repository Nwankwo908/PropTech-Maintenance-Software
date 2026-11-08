/** Shared MMS helpers — kind detection, storage vs provider URLs, inbox preview. */

export type SmsMediaKind = 'image' | 'video' | 'document' | 'audio'

/**
 * ready = the browser can show or play it.
 * processing = a playable copy is being made.
 * failed = conversion did not produce a playable copy.
 * unavailable = no playable copy yet. The message still stays visible.
 */
export type SmsMediaPreviewStatus = 'ready' | 'processing' | 'failed' | 'unavailable'

export type SmsMediaItem = {
  url: string
  kind: SmsMediaKind
  previewStatus?: SmsMediaPreviewStatus
  downloadUrl?: string
  label?: string
  /** Private storage path of the original. Playback copies are never stored here. */
  storagePath?: string
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|3gp|3gpp)(?:$|[?#])/i
const UNPLAYABLE_VIDEO_EXT = /\.(3gp|3gpp)(?:$|[?#])/i
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)(?:$|[?#])/i
const DOCUMENT_EXT = /\.(pdf)(?:$|[?#])/i
const AUDIO_EXT = /\.(m4a|aac|mp3|amr|wav|ogg)(?:$|[?#])/i

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
 * Twilio media URLs require HTTP Basic and must never be used in
 * `<img>` / `<video>` — the browser prompts for credentials.
 */
export function isProviderAuthMediaUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('api.twilio.com') || lower.includes('media.twilio.com')
}

export function mediaKindFromRef(ref: string): SmsMediaKind {
  const lower = ref.trim().toLowerCase()
  if (lower.includes('application/pdf') || DOCUMENT_EXT.test(lower)) return 'document'
  if (lower.includes('audio/') || AUDIO_EXT.test(lower)) return 'audio'
  if (lower.includes('video/') || VIDEO_EXT.test(lower)) return 'video'
  if (lower.includes('image/') || IMAGE_EXT.test(lower)) return 'image'
  return 'image'
}

export function mediaKindFromContentType(contentType: string): SmsMediaKind | null {
  const ct = contentType.trim().toLowerCase()
  if (ct === 'application/pdf' || ct.startsWith('application/pdf')) return 'document'
  if (ct.startsWith('audio/')) return 'audio'
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('image/')) return 'image'
  return null
}

/**
 * Videos that browsers often cannot play natively in the landlord inbox.
 * iPhone MMS video/3gpp is H.263 + AMR. HEVC/H.265 (common in .mov / hvc1)
 * also fails in many desktop Chromium sessions.
 */
export function needsBrowserVideoConversion(ref: string): boolean {
  const lower = ref.trim().toLowerCase()
  const pathOnly = lower.split('?')[0] ?? lower
  if (lower.includes('video/3gpp') || lower.includes('video/3gp')) return true
  if (
    lower.includes('hevc') ||
    lower.includes('hvc1') ||
    lower.includes('hev1') ||
    lower.includes('h265') ||
    lower.includes('video/quicktime')
  ) {
    return true
  }
  if (/\.mov(?:$|[?#])/i.test(pathOnly)) return true
  return UNPLAYABLE_VIDEO_EXT.test(pathOnly)
}

/** Stored next to the original. The original path is never replaced. */
export function playbackSiblingPath(original: string): string | null {
  const ref = original.trim()
  if (!isStorageMediaPath(ref) || !needsBrowserVideoConversion(ref)) return null
  return ref.replace(/\.[a-z0-9]+$/i, '.playback.mp4')
}

export function attachmentNoun(kind: SmsMediaKind, count = 1): string {
  const many = count !== 1
  if (kind === 'video') return many ? 'videos' : 'video'
  if (kind === 'audio') return many ? 'audio messages' : 'audio message'
  if (kind === 'document') return many ? 'documents' : 'document'
  return many ? 'photos' : 'photo'
}

/** Inbox / list preview when the latest SMS is media-only. */
export function inboxPreviewForSmsMessage(body: string, mediaUrls: unknown): string {
  const text = body.trim()
  if (text) return text
  const refs = normalizeMediaRefs(mediaUrls)
  if (refs.length === 0) return 'No messages yet.'
  const docCount = refs.filter((ref) => mediaKindFromRef(ref) === 'document').length
  const videoCount = refs.filter((ref) => mediaKindFromRef(ref) === 'video').length
  const audioCount = refs.filter((ref) => mediaKindFromRef(ref) === 'audio').length
  const imageCount = refs.length - videoCount - docCount - audioCount
  if (docCount > 0 && imageCount === 0 && videoCount === 0) {
    return docCount === 1 ? 'Sent a document' : 'Sent documents'
  }
  if (videoCount > 0 && imageCount > 0) {
    return refs.length === 2 ? 'Sent a photo and a video' : 'Sent photos and video'
  }
  if (videoCount > 0) return videoCount === 1 ? 'Sent a video' : 'Sent videos'
  if (audioCount > 0) return audioCount === 1 ? 'Sent an audio message' : 'Sent audio messages'
  if (imageCount > 0) return imageCount === 1 ? 'Sent a photo' : 'Sent photos'
  return 'Sent an attachment'
}
