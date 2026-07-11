import type { ReactNode } from 'react'
import { telHref } from '@/lib/phoneLinks'

function PhoneIcon({ className = 'size-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type CallPhoneButtonProps = {
  phone: string | null | undefined
  /** Button label (default: Call). */
  label?: string
  className?: string
  variant?: 'solid' | 'outline' | 'link'
  disabled?: boolean
  /** Shown when phone is missing (button hidden if omitted). */
  missingTitle?: string
}

const variantClass: Record<NonNullable<CallPhoneButtonProps['variant']>, string> = {
  solid:
    'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[10px] bg-[#101828] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1e2939] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  outline:
    'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[12px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  link: 'inline-flex items-center gap-1 text-[12px] font-medium text-[#0030b5] underline decoration-[#0030b5]/30 underline-offset-2 hover:text-[#002080] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0030b5]',
}

/** Opens the native phone dialer via `tel:` — no in-app VoIP. */
export function CallPhoneButton({
  phone,
  label = 'Call',
  className = '',
  variant = 'outline',
  disabled = false,
  missingTitle,
}: CallPhoneButtonProps) {
  const href = telHref(phone)
  if (!href) {
    if (!missingTitle) return null
    return (
      <span className="text-[12px] text-[#9ca3af]" title={missingTitle}>
        —
      </span>
    )
  }

  return (
    <a
      href={href}
      className={`${variantClass[variant]} ${className}`.trim()}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) event.preventDefault()
      }}
    >
      <PhoneIcon />
      {label}
    </a>
  )
}

export function PhoneTelLink({
  phone,
  className = '',
  children,
}: {
  phone: string | null | undefined
  className?: string
  children: ReactNode
}) {
  const href = telHref(phone)
  if (!href) return <span className={className}>{children}</span>
  return (
    <a href={href} className={`hover:text-[#0030b5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0030b5] ${className}`.trim()}>
      {children}
    </a>
  )
}
