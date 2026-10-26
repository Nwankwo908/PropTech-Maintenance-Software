import { useEffect, useId } from 'react'
import inviteEnvelopes from '@/assets/Flat coral envelopes in motion.png'
import { buildInvitePreview } from '@/lib/inviteMessagePreview'
import { uloAppUrl } from '@/lib/uloAppUrl'
import { onboardingBtnSecondaryClass } from './onboardingFieldStyles'

export type ReviewInvitePreview = {
  kind: 'resident' | 'vendor'
  name: string
  phone: string
  email: string
}

export function ReviewInvitePreviewModal({
  preview,
  companyName,
  onClose,
}: {
  preview: ReviewInvitePreview
  companyName?: string | null
  onClose: () => void
}) {
  const titleId = useId()
  const hasPhone = Boolean(preview.phone.trim())
  const blocks = buildInvitePreview({
    kind: preview.kind,
    recipientName: preview.name,
    companyName,
    channel: hasPhone ? 'sms' : 'email',
    link: preview.kind === 'vendor' ? uloAppUrl.vendorVerification('preview') : undefined,
  })
  const message = blocks[0]
  const title = hasPhone ? 'Text that will be sent' : 'Email that will be sent'
  const who = preview.name.trim() || (preview.kind === 'resident' ? 'this resident' : 'this vendor')

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1)]"
      >
        {/* Envelopes, with the bottom 35% of that frame cropped off. */}
        <div
          className="relative w-full shrink-0 overflow-hidden"
          style={{ aspectRatio: '1109 / 499' }}
        >
          <img
            src={inviteEnvelopes}
            alt=""
            className="absolute max-w-none"
            style={{ width: '113.075%', left: '-5.771%', top: '-47.495%' }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-white"
          />
        </div>
        <div className="p-6">
          <h2 id={titleId} className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
            {title}
          </h2>
          <p className="mt-2 text-[14px] leading-5 text-[#6b7280]">
            {who} will receive this when setup is complete.
          </p>
          {message ? (
            <section
              className="mt-4 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3"
              aria-label={`${message.label} preview`}
            >
              {message.subject ? (
                <p className="text-[13px] font-medium leading-5 text-[#0a0a0a]">{message.subject}</p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#364153]">
                {message.body}
              </p>
            </section>
          ) : null}
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className={onboardingBtnSecondaryClass}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
