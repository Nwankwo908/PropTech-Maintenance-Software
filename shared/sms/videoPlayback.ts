import {
  isStorageMediaPath,
  needsBrowserVideoConversion,
  playbackSiblingPath,
  type SmsMediaPreviewStatus,
} from './media.ts'

/** A second request inside this window waits instead of starting another encode. */
export const PLAYBACK_PROCESSING_FRESH_MS = 2 * 60 * 1000

export type PlaybackJobStatus = 'processing' | 'failed' | 'ready'

export type PlaybackStatusRecord = {
  status: PlaybackJobStatus
  error?: string
  hasAudio?: boolean
  audioPreserved?: boolean
  updatedAt: string
}

/** Status object stored next to the playable copy. The original path is never replaced. */
export function playbackStatusPath(original: string): string | null {
  const sibling = playbackSiblingPath(original)
  if (!sibling) return null
  return sibling.replace(/\.mp4$/i, '.json')
}

/** Inbound SMS objects live at sms/{conversationId}/... in the private uploads bucket. */
export function smsConversationIdFromStoragePath(path: string): string | null {
  const ref = path.trim()
  if (!isStorageMediaPath(ref) || ref.includes('..')) return null
  const match = ref.match(
    /^sms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i,
  )
  return match?.[1] ?? null
}

export function conversionAccessDecision(input: {
  path: string
  conversationFound: boolean
  resourceLandlordId: string | null
  mode: 'service' | 'user'
  userCanAccess: boolean
}): { ok: true; conversationId: string } | { ok: false; status: 400 | 403 | 404; error: string } {
  const conversationId = smsConversationIdFromStoragePath(input.path)
  if (!conversationId || !needsBrowserVideoConversion(input.path)) {
    return { ok: false, status: 400, error: 'That file cannot be converted.' }
  }
  if (!input.conversationFound || !input.resourceLandlordId) {
    return { ok: false, status: 404, error: 'Conversation not found.' }
  }
  if (input.mode === 'user' && !input.userCanAccess) {
    return { ok: false, status: 403, error: 'You do not have access to this conversation.' }
  }
  return { ok: true, conversationId }
}

export function shouldStartPlaybackJob(
  existing: PlaybackStatusRecord | null,
  fileReady: boolean,
  nowMs: number,
): 'start' | 'wait' | 'skip-ready' {
  if (fileReady && existing?.status !== 'processing') return 'skip-ready'
  if (existing?.status === 'processing') {
    const updated = Date.parse(existing.updatedAt)
    if (Number.isFinite(updated) && nowMs - updated < PLAYBACK_PROCESSING_FRESH_MS) return 'wait'
  }
  if (fileReady) return 'skip-ready'
  return 'start'
}

/** H.264 + AAC (when the source has audio) with faststart so browsers can play it. */
export function browserPlaybackFfmpegArgs(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean,
): string[] {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-c:v',
    'libx264',
    '-profile:v',
    'baseline',
    '-level',
    '3.0',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
  ]
  if (hasAudio) {
    args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '1')
  } else {
    args.push('-an')
  }
  args.push(outputPath)
  return args
}

const STREAM_PREFIX = String.raw`Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:`

export function inputHasAudioStream(ffmpegInfo: string): boolean {
  return new RegExp(`${STREAM_PREFIX} Audio:`).test(ffmpegInfo)
}

export function outputPlaybackCheck(
  ffmpegInfo: string,
  inputHadAudio: boolean,
): { ok: true } | { ok: false; reason: string } {
  const video = new RegExp(`${STREAM_PREFIX} Video:\\s*h264\\b`, 'i').test(ffmpegInfo)
  const audio = new RegExp(`${STREAM_PREFIX} Audio:\\s*aac\\b`, 'i').test(ffmpegInfo)
  if (!video) return { ok: false, reason: 'The converted file is not H.264.' }
  if (inputHadAudio && !audio) {
    return { ok: false, reason: 'The original has audio, and the converted file does not.' }
  }
  return { ok: true }
}

export function choosePlaybackPreview(input: {
  needsConversion: boolean
  playbackReady: boolean
  playbackUrl: string
  downloadUrl: string
  status: PlaybackJobStatus | null
}): { url: string; downloadUrl: string; previewStatus: SmsMediaPreviewStatus } {
  if (!input.needsConversion) {
    return {
      url: input.downloadUrl,
      downloadUrl: input.downloadUrl,
      previewStatus: input.downloadUrl ? 'ready' : 'unavailable',
    }
  }
  // A signed sibling plus a ready status is enough. The byte probe can fail in the
  // browser (CORS on Range) even when the playable copy is already saved.
  if (input.playbackUrl && (input.playbackReady || input.status === 'ready')) {
    return {
      url: input.playbackUrl,
      downloadUrl: input.downloadUrl || input.playbackUrl,
      previewStatus: 'ready',
    }
  }
  if (input.status === 'processing') {
    return { url: '', downloadUrl: input.downloadUrl, previewStatus: 'processing' }
  }
  if (input.status === 'failed') {
    return { url: '', downloadUrl: input.downloadUrl, previewStatus: 'failed' }
  }
  return { url: '', downloadUrl: input.downloadUrl, previewStatus: 'unavailable' }
}
