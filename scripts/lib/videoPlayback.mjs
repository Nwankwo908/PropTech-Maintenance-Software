/** Runtime copy of shared/sms/videoPlayback.ts for the Vercel function. */

export const PLAYBACK_PROCESSING_FRESH_MS = 2 * 60 * 1000

const UNPLAYABLE_VIDEO_EXT = /\.(3gp|3gpp)(?:$|[?#])/i

export function needsBrowserVideoConversion(ref) {
  const lower = ref.trim().toLowerCase()
  if (lower.includes('video/3gpp') || lower.includes('video/3gp')) return true
  return UNPLAYABLE_VIDEO_EXT.test(lower.split('?')[0] ?? lower)
}

export function playbackSiblingPath(original) {
  const ref = original.trim()
  if (!ref || ref.includes('://') || /^https?:\/\//i.test(ref)) return null
  if (!needsBrowserVideoConversion(ref)) return null
  return ref.replace(/\.[a-z0-9]+$/i, '.playback.mp4')
}

export function playbackStatusPath(original) {
  const sibling = playbackSiblingPath(original)
  if (!sibling) return null
  return sibling.replace(/\.mp4$/i, '.json')
}

export function smsConversationIdFromStoragePath(path) {
  const ref = path.trim()
  if (!ref || ref.includes('..') || ref.includes('://')) return null
  const match = ref.match(/^sms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i)
  return match?.[1] ?? null
}

export function conversionAccessDecision(input) {
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

export function shouldStartPlaybackJob(existing, fileReady, nowMs) {
  if (fileReady && existing?.status !== 'processing') return 'skip-ready'
  if (existing?.status === 'processing') {
    const updated = Date.parse(existing.updatedAt)
    if (Number.isFinite(updated) && nowMs - updated < PLAYBACK_PROCESSING_FRESH_MS) return 'wait'
  }
  if (fileReady) return 'skip-ready'
  return 'start'
}

export function browserPlaybackFfmpegArgs(inputPath, outputPath, hasAudio) {
  const args = [
    '-y', '-i', inputPath,
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
  ]
  if (hasAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '1')
  else args.push('-an')
  args.push(outputPath)
  return args
}

const STREAM_PREFIX = String.raw`Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:`

export function inputHasAudioStream(ffmpegInfo) {
  return new RegExp(`${STREAM_PREFIX} Audio:`).test(ffmpegInfo)
}

export function outputPlaybackCheck(ffmpegInfo, inputHadAudio) {
  const video = new RegExp(`${STREAM_PREFIX} Video:\\s*h264\\b`, 'i').test(ffmpegInfo)
  const audio = new RegExp(`${STREAM_PREFIX} Audio:\\s*aac\\b`, 'i').test(ffmpegInfo)
  if (!video) return { ok: false, reason: 'The converted file is not H.264.' }
  if (inputHadAudio && !audio) {
    return { ok: false, reason: 'The original has audio, and the converted file does not.' }
  }
  return { ok: true }
}
