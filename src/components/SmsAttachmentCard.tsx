import { useEffect, useRef, useState } from 'react'
import { requestSmsVideoPlayback } from '@/api/convertSmsMedia'
import type { SmsMediaItem, SmsMediaPreviewStatus } from '@/lib/smsMedia'

function downloadLink(url: string, label: string) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[12px] font-semibold text-[#0030b5] underline"
    >
      {label}
    </a>
  )
}

function statusCopy(status: SmsMediaPreviewStatus): string {
  if (status === 'processing') {
    return 'Preparing a version you can play. The original file is still saved.'
  }
  if (status === 'failed') {
    return "We couldn't prepare a preview. The original file is still saved."
  }
  return "Preview isn't available yet. The original file is still saved."
}

export function SmsAttachmentCard({ item }: { item: SmsMediaItem }) {
  const [local, setLocal] = useState(item)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    setLocal(item)
    setPlaybackFailed(false)
  }, [item])

  async function retry() {
    if (!local.storagePath || busy) return
    setBusy(true)
    setLocal((current) => ({ ...current, previewStatus: 'processing' }))
    const next = await requestSmsVideoPlayback(local.storagePath)
    setLocal((current) => ({
      ...current,
      ...next,
      storagePath: current.storagePath,
      kind: current.kind,
      label: current.label,
    }))
    setPlaybackFailed(false)
    setBusy(false)
  }

  useEffect(() => {
    if (started.current) return
    if (item.previewStatus !== 'unavailable' || !item.storagePath) return
    if (!needsRetry(item)) return
    started.current = true
    void retry()
    // The first view of an unconverted video starts one conversion. Retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.previewStatus, item.storagePath])

  const status: SmsMediaPreviewStatus = playbackFailed
    ? 'failed'
    : (local.previewStatus ?? 'ready')
  const downloadUrl = local.downloadUrl || (status === 'ready' ? local.url : '')
  const label = local.label?.trim() || 'Attachment'
  const canPlay = status === 'ready' && Boolean(local.url) && !playbackFailed

  if (!canPlay) {
    const action = status === 'unavailable' ? 'Prepare preview' : 'Try again'
    return (
      <div className="w-full max-w-[260px] rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
        <p className="text-[13px] font-semibold text-[#0a0a0a]">{label}</p>
        <p className="mt-1 text-[12px] leading-4 text-[#364153]">{statusCopy(status)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {local.storagePath ? (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy}
              className="text-[12px] font-semibold text-[#0030b5] underline disabled:text-[#6a7282]"
            >
              {busy ? 'Preparing…' : action}
            </button>
          ) : null}
          {downloadLink(downloadUrl, 'Open original')}
        </div>
      </div>
    )
  }

  if (local.kind === 'video') {
    return (
      <div className="flex w-full max-w-[260px] flex-col gap-1">
        <video
          src={local.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setPlaybackFailed(true)}
          className="max-h-64 w-full rounded-[12px] bg-[#0a0a0a] object-contain"
        />
        {downloadUrl ? downloadLink(downloadUrl, 'Open original') : null}
      </div>
    )
  }

  if (local.kind === 'audio') {
    return (
      <div className="flex w-full max-w-[260px] flex-col gap-1">
        <audio src={local.url} controls preload="metadata" onError={() => setPlaybackFailed(true)} />
        {downloadUrl ? downloadLink(downloadUrl, 'Open original') : null}
      </div>
    )
  }

  if (local.kind === 'document') {
    return (
      <div className="w-full max-w-[260px] rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
        <p className="text-[13px] font-semibold text-[#0a0a0a]">{label}</p>
        <div className="mt-2">{downloadLink(local.url, 'Open document')}</div>
      </div>
    )
  }

  return (
    <a href={local.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[12px]">
      <img
        src={local.url}
        alt={label}
        onError={() => setPlaybackFailed(true)}
        className="max-h-64 w-full max-w-[260px] object-cover"
      />
    </a>
  )
}

function needsRetry(item: SmsMediaItem): boolean {
  return item.kind === 'video' && Boolean(item.storagePath)
}
