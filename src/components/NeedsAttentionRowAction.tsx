import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ADMIN_ATTENTION_ACTION_CLASS } from '@/lib/adminRightRail'

const ASSIGN_VENDOR_RE = /assign\s*vendor/i

export function isNeedsAttentionAssignVendorAction(label: string | null | undefined): boolean {
  return ASSIGN_VENDOR_RE.test(label ?? '')
}

function AttentionChevronIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const CHEVRON_TRAILING_CLASS =
  'inline-flex size-9 shrink-0 items-center justify-center self-start text-[#0A4D38] sm:self-center'

const ROW_CLASS =
  'sa-row sa-press flex w-full cursor-pointer text-left hover:bg-[#f9fafb] focus-visible:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5]'

type NeedsAttentionRowProps = {
  actionLabel: string
  actionTo?: string
  onAction?: () => void
  /** Called when a link action navigates (e.g. close the View all rail). */
  onNavigate?: () => void
  className?: string
  style?: CSSProperties
  children: ReactNode
}

function RowTrailing({ actionLabel }: { actionLabel: string }) {
  if (isNeedsAttentionAssignVendorAction(actionLabel)) {
    return (
      <span className={CHEVRON_TRAILING_CLASS} aria-hidden>
        <AttentionChevronIcon />
      </span>
    )
  }
  return (
    <span
      className={`${ADMIN_ATTENTION_ACTION_CLASS} pointer-events-none shrink-0 self-start sm:self-center`}
      aria-hidden
    >
      {actionLabel} →
    </span>
  )
}

/** Entire attention row is clickable; trailing control is visual only. */
export function NeedsAttentionRow({
  actionLabel,
  actionTo,
  onAction,
  onNavigate,
  className,
  style,
  children,
}: NeedsAttentionRowProps) {
  const rowClass = [ROW_CLASS, className].filter(Boolean).join(' ')

  if (onAction) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onAction()
    }
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onAction}
        onKeyDown={onKeyDown}
        className={rowClass}
        style={style}
      >
        {children}
        <RowTrailing actionLabel={actionLabel} />
      </div>
    )
  }

  return (
    <Link
      to={actionTo ?? '/admin/workflows'}
      onClick={onNavigate}
      className={rowClass}
      style={style}
    >
      {children}
      <RowTrailing actionLabel={actionLabel} />
    </Link>
  )
}
