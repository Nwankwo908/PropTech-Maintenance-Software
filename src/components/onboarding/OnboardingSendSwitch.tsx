import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { NounInfoIcon } from '@/components/NounInfoIcon'
import {
  ReviewInvitePreviewModal,
  type ReviewInvitePreview,
} from '@/components/onboarding/ReviewInvitePreviewModal'

export const TENANT_SEND_INVITE_INFO =
  'Turning this on sends the tenant an SMS invite. If they don’t see it, ask them to check their Unknown Senders or spam folder. They can reply YES to activate.'

export const VENDOR_SEND_INVITE_INFO =
  'Turning this on sends the vendor a verification invite so they can confirm their details before receiving jobs.'

/** Info tip shared by onboarding switches and Residents / Vendors Send invite actions. */
export function SendInviteInfoTip({
  variant = 'tenant',
  className = '',
}: {
  variant?: 'tenant' | 'vendor'
  className?: string
}) {
  const tipId = useId()
  return (
    <span className={`group relative inline-flex ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex rounded-full p-0.5 text-[#9ca3af] outline-none hover:text-[#6a7282] focus-visible:ring-2 focus-visible:ring-[#9E439F]/30 focus-visible:ring-offset-1"
        aria-label="About Send invite"
        aria-describedby={tipId}
      >
        <NounInfoIcon />
      </button>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden w-[min(16.5rem,calc(100vw-2rem))] rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-left text-[12px] font-medium leading-4 text-[#475569] shadow-[0px_8px_24px_rgba(0,0,0,0.12)] group-hover:block group-focus-within:block"
      >
        {variant === 'tenant' ? (
          <>
            Turning this on sends the tenant an SMS invite. If they don’t see it, ask them to check
            their Unknown Senders or spam folder. They can reply{' '}
            <strong className="font-semibold text-[#334155]">YES</strong> to activate.
          </>
        ) : (
          VENDOR_SEND_INVITE_INFO
        )}
      </span>
    </span>
  )
}

/** Compact switch: send invite when setup completes. */
export function OnboardingSendSwitch({
  enabled,
  onChange,
  disabled,
  id,
  variant = 'tenant',
  'aria-label': ariaLabel,
  messagePreview,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
  id?: string
  variant?: 'tenant' | 'vendor'
  'aria-label'?: string
  /** Shown when the switch is turned on. */
  messagePreview?: ReviewInvitePreview & { companyName?: string | null }
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const resolvedAriaLabel =
    ariaLabel ??
    (variant === 'vendor'
      ? 'Send verification invite when setup completes'
      : 'Send invite when setup completes')

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-medium leading-none text-[#9E439F]">Send invite text</span>
        <SendInviteInfoTip variant={variant} />
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={enabled}
        aria-label={resolvedAriaLabel}
        disabled={disabled}
        onClick={() => {
          const next = !enabled
          onChange(next)
          if (next && messagePreview) setPreviewOpen(true)
        }}
        style={{ backgroundColor: enabled ? '#9E439F' : '#e5e7eb' }}
        className={[
          'relative h-6 w-11 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#9E439F]/30 focus-visible:ring-offset-2',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
      {previewOpen && messagePreview
        ? createPortal(
            <ReviewInvitePreviewModal
              preview={messagePreview}
              companyName={messagePreview.companyName}
              onClose={() => setPreviewOpen(false)}
            />,
            document.body,
          )
        : null}
    </div>
  )
}
