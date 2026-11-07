/**
 * Home Check SMS media allowlist — still photos plus phone-camera video.
 * Dashboard still-upload stays image-only elsewhere.
 */

export const HOME_CHECK_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const HOME_CHECK_VIDEO_MAX_BYTES = 50 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/3gpp',
  'video/3gp',
  'video/webm',
])

export function normalizeHomeCheckMediaType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isHomeCheckVideoMediaType(contentType: string | null | undefined): boolean {
  const mime = normalizeHomeCheckMediaType(contentType)
  return mime.startsWith('video/') && VIDEO_TYPES.has(mime)
}

export function isHomeCheckImageMediaType(contentType: string | null | undefined): boolean {
  return IMAGE_TYPES.has(normalizeHomeCheckMediaType(contentType))
}

export function isHomeCheckAcceptedMediaType(contentType: string | null | undefined): boolean {
  const mime = normalizeHomeCheckMediaType(contentType)
  return IMAGE_TYPES.has(mime) || VIDEO_TYPES.has(mime)
}

export function homeCheckMediaMaxBytes(contentType: string | null | undefined): number {
  return isHomeCheckVideoMediaType(contentType)
    ? HOME_CHECK_VIDEO_MAX_BYTES
    : HOME_CHECK_IMAGE_MAX_BYTES
}

export type HomeCheckMediaGateResult =
  | { ok: true; mime: string; maxBytes: number; isVideo: boolean }
  | { ok: false; reply: string }

/** Attach-time gate for a downloaded inbound blob. */
export function gateHomeCheckSmsMedia(input: {
  contentType: string | null | undefined
  sizeBytes: number
}): HomeCheckMediaGateResult {
  const mime = normalizeHomeCheckMediaType(input.contentType)
  const isVideo = VIDEO_TYPES.has(mime)
  const isImage = IMAGE_TYPES.has(mime)
  if (!isVideo && !isImage) {
    return {
      ok: false,
      reply:
        'Please send a photo (JPEG, PNG, or WebP) or a phone-camera video (MP4, MOV, or similar) under the size limit.',
    }
  }
  const maxBytes = isVideo ? HOME_CHECK_VIDEO_MAX_BYTES : HOME_CHECK_IMAGE_MAX_BYTES
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
    return {
      ok: false,
      reply: isVideo
        ? 'Please send a phone-camera video under 50 MB.'
        : 'Please send a JPEG, PNG, or WebP photo under 10 MB.',
    }
  }
  return { ok: true, mime, maxBytes, isVideo }
}
