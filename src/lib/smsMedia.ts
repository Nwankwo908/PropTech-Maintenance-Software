import {
  attachmentNoun,
  isHttpUrl,
  isProviderAuthMediaUrl,
  isStorageMediaPath,
  mediaKindFromRef,
  needsBrowserVideoConversion,
  normalizeMediaRefs,
  playbackSiblingPath,
  type SmsMediaItem,
} from '@shared/sms/media.ts'
import {
  choosePlaybackPreview,
  playbackStatusPath,
  type PlaybackStatusRecord,
} from '@shared/sms/videoPlayback.ts'

export type { SmsMediaItem, SmsMediaKind, SmsMediaPreviewStatus } from '@shared/sms/media.ts'
export {
  inboxPreviewForSmsMessage,
  isProviderAuthMediaUrl,
  isStorageMediaPath,
  mediaKindFromRef,
  normalizeMediaRefs,
} from '@shared/sms/media.ts'

const SIGN_TTL_SECONDS = 3600

async function signStoragePaths(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return signed

  const unique = [...new Set(paths)]
  const { data, error } = await supabase.storage
    .from('maintenance-uploads')
    .createSignedUrls(unique, SIGN_TTL_SECONDS)

  if (!error && Array.isArray(data)) {
    data.forEach((entry, index) => {
      const record = entry as {
        path?: string | null
        signedUrl?: string | null
        signedURL?: string | null
        error?: unknown
      }
      const path =
        (typeof record.path === 'string' && record.path) || unique[index] || ''
      const url = record.signedUrl || record.signedURL || ''
      if (path && url && !record.error) signed.set(path, url)
    })
  }

  if (signed.size === unique.length) return signed

  for (const path of unique) {
    if (signed.has(path)) continue
    const { data: one, error: oneError } = await supabase.storage
      .from('maintenance-uploads')
      .createSignedUrl(path, SIGN_TTL_SECONDS)
    if (oneError || !one?.signedUrl) continue
    signed.set(path, one.signedUrl)
  }

  return signed
}

async function bytesLookLikeMp4(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-31' } })
    if (!(res.ok || res.status === 206)) return false
    const head = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))
    return head.includes('ftyp')
  } catch {
    return false
  }
}

async function readPlaybackStatus(url: string | undefined): Promise<PlaybackStatusRecord | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = (await res.json()) as PlaybackStatusRecord
    if (body?.status === 'processing' || body?.status === 'failed' || body?.status === 'ready') {
      return body
    }
    return null
  } catch {
    return null
  }
}

function itemsFromRefs(
  refs: string[],
  signedByPath: Map<string, string>,
  checked: Map<string, { playbackReady: boolean; status: PlaybackStatusRecord['status'] | null }>,
): SmsMediaItem[] {
  const items: SmsMediaItem[] = []
  for (const ref of refs) {
    const kind = mediaKindFromRef(ref)
    const label = attachmentNoun(kind)
    const sibling = playbackSiblingPath(ref)
    const playbackUrl = sibling ? signedByPath.get(sibling) || '' : ''
    const storedUrl = isStorageMediaPath(ref) ? signedByPath.get(ref) : undefined
    const publicUrl = !isStorageMediaPath(ref) && isHttpUrl(ref) && !isProviderAuthMediaUrl(ref)
      ? ref
      : undefined
    const downloadUrl = storedUrl || publicUrl || ''
    const extra = checked.get(ref)
    const chosen = choosePlaybackPreview({
      needsConversion: needsBrowserVideoConversion(ref),
      playbackReady: extra?.playbackReady === true,
      playbackUrl,
      downloadUrl,
      status: extra?.status ?? null,
    })
    items.push({
      url: chosen.url,
      downloadUrl: chosen.downloadUrl,
      kind,
      label,
      previewStatus: chosen.previewStatus,
      ...(isStorageMediaPath(ref) ? { storagePath: ref } : {}),
    })
  }
  return items
}

async function checkPlaybackCopies(
  refs: string[],
  signedByPath: Map<string, string>,
): Promise<Map<string, { playbackReady: boolean; status: PlaybackStatusRecord['status'] | null }>> {
  const checked = new Map<string, { playbackReady: boolean; status: PlaybackStatusRecord['status'] | null }>()
  await Promise.all(refs.map(async (ref) => {
    if (!needsBrowserVideoConversion(ref)) return
    const sibling = playbackSiblingPath(ref)
    const playbackUrl = sibling ? signedByPath.get(sibling) : undefined
    let status: PlaybackStatusRecord['status'] | null = null
    const statusPath = playbackStatusPath(ref)
    const record = await readPlaybackStatus(statusPath ? signedByPath.get(statusPath) : undefined)
    status = record?.status ?? null
    // Prefer the saved ready status. Fall back to a byte probe only when status is unknown.
    // A successful sign alone is not enough — createSignedUrl can mint a URL for a missing object.
    let playbackReady = status === 'ready' && Boolean(playbackUrl)
    if (!playbackReady && playbackUrl && status == null) {
      playbackReady = await bytesLookLikeMp4(playbackUrl)
    }
    checked.set(ref, { playbackReady, status })
  }))
  return checked
}

/**
 * Private maintenance-uploads is not selectable by the browser session.
 * When a playable sibling already exists, the convert endpoint (service role)
 * returns signed playback + original URLs for landlords who can access the thread.
 */
async function enrichUnresolvedPlayback(items: SmsMediaItem[]): Promise<SmsMediaItem[]> {
  const { requestSmsVideoPlayback } = await import('@/api/convertSmsMedia')
  return Promise.all(
    items.map(async (item) => {
      if (!item.storagePath || !needsBrowserVideoConversion(item.storagePath)) return item
      if (item.previewStatus === 'ready' && item.url) return item
      const next = await requestSmsVideoPlayback(item.storagePath)
      if (next.previewStatus === 'ready' && next.url) {
        return {
          ...item,
          url: next.url,
          downloadUrl: next.downloadUrl || item.downloadUrl,
          previewStatus: 'ready',
        }
      }
      return {
        ...item,
        downloadUrl: next.downloadUrl || item.downloadUrl,
        previewStatus: next.previewStatus || item.previewStatus || 'unavailable',
      }
    }),
  )
}

/** Resolve stored MMS refs into browser-safe signed URLs (skips Twilio). */
export async function resolveSmsMediaItems(refs: unknown): Promise<SmsMediaItem[]> {
  const list = normalizeMediaRefs(refs)
  if (list.length === 0) return []
  const stored = list.filter(isStorageMediaPath)
  const siblings = stored
    .map((path) => playbackSiblingPath(path))
    .filter((path): path is string => Boolean(path))
  const statusPaths = stored
    .map((path) => playbackStatusPath(path))
    .filter((path): path is string => Boolean(path))
  const signedByPath = await signStoragePaths([...stored, ...siblings, ...statusPaths])
  const checked = await checkPlaybackCopies(list, signedByPath)
  return enrichUnresolvedPlayback(itemsFromRefs(list, signedByPath, checked))
}

export async function resolveSmsMediaForMessages(
  mediaUrlsByMessage: unknown[],
): Promise<SmsMediaItem[][]> {
  const refsByMessage = mediaUrlsByMessage.map(normalizeMediaRefs)
  const unique = [...new Set(refsByMessage.flat())]
  if (unique.length === 0) return refsByMessage.map(() => [])
  const stored = unique.filter(isStorageMediaPath)
  const siblings = stored
    .map((path) => playbackSiblingPath(path))
    .filter((path): path is string => Boolean(path))
  const statusPaths = stored
    .map((path) => playbackStatusPath(path))
    .filter((path): path is string => Boolean(path))
  const signedByPath = await signStoragePaths([...stored, ...siblings, ...statusPaths])
  const checked = await checkPlaybackCopies(unique, signedByPath)
  const flat = await enrichUnresolvedPlayback(itemsFromRefs(unique, signedByPath, checked))
  const byRef = new Map(unique.map((ref, index) => [ref, flat[index]]))
  return refsByMessage.map((refs) => refs.map((ref) => byRef.get(ref)).filter((item): item is SmsMediaItem => Boolean(item)))
}
