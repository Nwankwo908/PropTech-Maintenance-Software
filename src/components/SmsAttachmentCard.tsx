import { useState } from 'react'
import type { SmsMediaItem } from '@/lib/smsMedia'

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

export function SmsAttachmentCard({ item }: { item: SmsMediaItem }) {
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const status = item.previewStatus ?? 'ready'
  const downloadUrl = item.downloadUrl || item.url
  const label = item.label?.trim() || 'Attachment'
  const canPlay = status === 'ready' && Boolean(item.url) && !playbackFailed

  if (!canPlay) {
    return (
      <div className="w-full max-w-[260px] rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
        <p className="text-[13px] font-semibold text-[#0a0a0a]">{label}</p>
        <p className="mt-1 text-[12px] leading-4 text-[#364153]">
          Preview isn't available. The original file is still saved.
        </p>
        <div className="mt-2">{downloadLink(downloadUrl, 'Open original')}</div>
      </div>
    )
  }

  if (item.kind === 'video') {
    return (
      <div className="flex w-full max-w-[260px] flex-col gap-1">
        <video
          src={item.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setPlaybackFailed(true)}
          className="max-h-64 w-full rounded-[12px] bg-[#0a0a0a] object-contain"
        />
        {downloadUrl ? downloadLink(downloadUrl, 'Download') : null}
      </div>
    )
  }

  if (item.kind === 'audio') {
    return (
      <div className="flex w-full max-w-[260px] flex-col gap-1">
        <audio src={item.url} controls preload="metadata" onError={() => setPlaybackFailed(true)} />
        {downloadUrl ? downloadLink(downloadUrl, 'Download') : null}
      </div>
    )
  }

  if (item.kind === 'document') {
    return (
      <div className="w-full max-w-[260px] rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
        <p className="text-[13px] font-semibold text-[#0a0a0a]">{label}</p>
        <div className="mt-2">{downloadLink(item.url, 'Open document')}</div>
      </div>
    )
  }

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[12px]">
      <img
        src={item.url}
        alt={label}
        onError={() => setPlaybackFailed(true)}
        className="max-h-64 w-full max-w-[260px] object-cover"
      />
    </a>
  )
}
