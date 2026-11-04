import type { SmsMediaItem, SmsMediaPreviewStatus } from '@/lib/smsMedia'

export type SmsPlaybackRequestResult = Pick<SmsMediaItem, 'url' | 'downloadUrl' | 'previewStatus'> & {
  error?: string
}

/**
 * Ask the site to prepare a browser-playable copy.
 * The original storage path is unchanged. Signed URLs come back only after a save.
 */
export async function requestSmsVideoPlayback(storagePath: string): Promise<SmsPlaybackRequestResult> {
  const failed = (previewStatus: SmsMediaPreviewStatus, error: string): SmsPlaybackRequestResult => ({
    url: '',
    previewStatus,
    error,
  })
  try {
    const { supabase } = await import('@/lib/supabase')
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    const token = session?.access_token
    if (!token) return failed('failed', 'Sign in again to prepare this preview.')
    const res = await fetch('/api/convert-sms-media', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path: storagePath }),
    })
    const body = (await res.json().catch(() => null)) as {
      status?: SmsMediaPreviewStatus
      playbackUrl?: string
      originalUrl?: string
      error?: string
    } | null
    if (!res.ok) {
      return failed('failed', body?.error || 'We couldn’t prepare a preview.')
    }
    const status = body?.status === 'ready' || body?.status === 'processing' || body?.status === 'failed'
      ? body.status
      : 'failed'
    return {
      url: status === 'ready' ? body?.playbackUrl || '' : '',
      downloadUrl: body?.originalUrl || '',
      previewStatus: status === 'ready' && body?.playbackUrl ? 'ready' : status === 'processing' ? 'processing' : 'failed',
      error: body?.error,
    }
  } catch {
    return failed('failed', 'We couldn’t prepare a preview.')
  }
}
