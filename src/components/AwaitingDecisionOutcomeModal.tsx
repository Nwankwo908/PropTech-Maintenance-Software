import { useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import type { AwaitingDecisionOutcome } from '@/lib/awaitingDecisionOutcome'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-5 text-[#00a63e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg className="size-5 text-[#1447e6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function kindIcon(kind: AwaitingDecisionOutcome['kind']) {
  if (kind === 'moved') return <ArrowIcon />
  if (kind === 'updated') return <EditIcon />
  return <CheckIcon />
}

function kindBadge(kind: AwaitingDecisionOutcome['kind']): { label: string; className: string } {
  if (kind === 'moved') {
    return { label: 'Moved', className: 'bg-[#eff6ff] text-[#1447e6]' }
  }
  if (kind === 'updated') {
    return { label: 'Updated', className: 'bg-[#f3f4f6] text-[#364153]' }
  }
  return { label: 'Resolved', className: 'bg-[#f0fdf4] text-[#008236]' }
}

type AwaitingDecisionOutcomeModalProps = {
  open: boolean
  outcome: AwaitingDecisionOutcome | null
  onClose: () => void
}

/** Acknowledges when an awaiting-decision item was resolved, moved, or updated. */
export function AwaitingDecisionOutcomeModal({
  open,
  outcome,
  onClose,
}: AwaitingDecisionOutcomeModalProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !outcome) return null

  const badge = kindBadge(outcome.kind)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
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
        className="relative flex w-full max-w-[min(100vw,480px)] flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>

        <div className="px-6 pb-2 pt-6">
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f9fafb]">
              {kindIcon(outcome.kind)}
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${badge.className}`}
              >
                {badge.label}
              </span>
              <h2
                id={titleId}
                className="mt-2 text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
              >
                {outcome.headline}
              </h2>
            </div>
          </div>

          <div className="mt-5 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
            <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{outcome.operationTitle}</p>
            {outcome.context ? (
              <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">{outcome.context}</p>
            ) : null}
          </div>

          <p className="mt-4 text-[14px] leading-6 text-[#364153]">{outcome.detail}</p>

          {outcome.removedFromQueue ? (
            <p className="mt-3 text-[12px] leading-4 text-[#6a7282]">
              This item is no longer listed under Needs Your Attention on your overview.
            </p>
          ) : null}
        </div>

        <footer className="mt-4 flex flex-col gap-2 border-t border-[#e5e7eb] px-6 py-4 sm:flex-row sm:justify-end">
          {outcome.actionTo && outcome.actionLabel ? (
            <Link
              to={outcome.actionTo}
              onClick={onClose}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              {outcome.actionLabel}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-[#0a0a0a] px-4 py-2.5 text-[13px] font-medium text-white outline-none transition-colors duration-150 hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Got it
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AwaitingDecisionOutcomeModal
