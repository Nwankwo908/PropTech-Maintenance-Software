import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { clearTryDemoWelcomePending } from '@/lib/activeLandlord'
import { markTryDemoAttentionGuidePending } from '@/lib/tryDemoAttentionGuide'
import { playUiClickSound } from '@/lib/uiClickSound'

type TryDemoWelcomeModalProps = {
  open: boolean
  onClose: () => void
}

/**
 * One-shot welcome after landing Try Demo finishes and Demo admin mounts.
 * Portaled to document.body so AdminLayout overflow cannot clip it.
 */
export function TryDemoWelcomeModal({ open, onClose }: TryDemoWelcomeModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearTryDemoWelcomePending()
        markTryDemoAttentionGuidePending()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  function dismiss() {
    playUiClickSound()
    clearTryDemoWelcomePending()
    // Next: pin coachmark on Overview → Needs Your Attention (count badge).
    markTryDemoAttentionGuidePending()
    onClose()
  }

  return createPortal(
    <div
      className="sa-scrim fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="try-demo-welcome-title"
    >
      <div className="sa-modal relative w-full max-w-[440px] rounded-3xl bg-white p-8 text-center shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]">
        <h2
          id="try-demo-welcome-title"
          className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#101828]"
        >
          Welcome to Ulo Home
        </h2>
        <p className="mt-3 text-[15px] font-medium leading-6 text-[#364153]">
          We make owning rental property feel passive again.
        </p>
        <p className="mt-4 text-[15px] font-normal leading-6 text-[#6a7282]">
          Step into the shoes of a landlord and explore one view across all your properties, built
          from every job, text, and vendor interaction.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-8 flex h-[46px] w-full items-center justify-center rounded-2xl bg-[#55B6A1] text-sm font-semibold text-white outline-none hover:bg-[#4aa892] focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2"
        >
          Ok
        </button>
      </div>
    </div>,
    document.body,
  )
}
