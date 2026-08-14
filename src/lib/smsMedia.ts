import {
  isHttpUrl,
  isProviderAuthMediaUrl,
  isStorageMediaPath,
  mediaKindFromRef,
  normalizeMediaRefs,
  type SmsMediaItem,
} from '@shared/sms/media.ts'

export type { SmsMediaItem, SmsMediaKind } from '@shared/sms/media.ts'
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

function itemsFromRefs(
  refs: string[],
  signedByPath: Map<string, string>,
): SmsMediaItem[] {
  const items: SmsMediaItem[] = []
  for (const ref of refs) {
    if (isStorageMediaPath(ref)) {
      const url = signedByPath.get(ref)
      if (!url) continue
      items.push({ url, kind: mediaKindFromRef(ref) })
      continue
    }
    if (isProviderAuthMediaUrl(ref)) continue
    if (isHttpUrl(ref)) {
      items.push({ url: ref, kind: mediaKindFromRef(ref) })
    }
  }
  return items
}

/** Resolve stored MMS refs into browser-safe signed URLs (skips Twilio/Telnyx). */
export async function resolveSmsMediaItems(refs: unknown): Promise<SmsMediaItem[]> {
  const list = normalizeMediaRefs(refs)
  if (list.length === 0) return []
  const signedByPath = await signStoragePaths(list.filter(isStorageMediaPath))
  return itemsFromRefs(list, signedByPath)
}

export async function resolveSmsMediaForMessages(
  mediaUrlsByMessage: unknown[],
): Promise<SmsMediaItem[][]> {
  const refsByMessage = mediaUrlsByMessage.map(normalizeMediaRefs)
  const unique = [...new Set(refsByMessage.flat())]
  if (unique.length === 0) return refsByMessage.map(() => [])
  const signedByPath = await signStoragePaths(unique.filter(isStorageMediaPath))
  return refsByMessage.map((refs) => itemsFromRefs(refs, signedByPath))
}
