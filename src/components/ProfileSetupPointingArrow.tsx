import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PROFILE_SETUP_NAV_ATTR } from '@/lib/setupSuccessChecklist'

type Anchor = { top: number; left: number }

/**
 * Small arrow icon next to the Profile setup nav link that nudges toward it
 * while the Property Health "Not Available" block is hovered.
 */
export function ProfileSetupPointingArrow({ active }: { active: boolean }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  useEffect(() => {
    if (!active) {
      setAnchor(null)
      return
    }

    const update = () => {
      const target = document.querySelector<HTMLElement>(`[${PROFILE_SETUP_NAV_ATTR}]`)
      if (!target) {
        setAnchor(null)
        return
      }
      const rect = target.getBoundingClientRect()
      setAnchor({
        top: rect.top + rect.height / 2,
        left: rect.right + 10,
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active])

  if (!active || !anchor || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[80] -translate-y-1/2 sa-enter-scale"
      style={{ top: anchor.top, left: anchor.left }}
      aria-hidden
    >
      <span className="ulo-profile-setup-nudge-arrow inline-flex size-7 items-center justify-center text-[#AF63AF]">
        <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
          <path
            d="M19 12H7m0 0 5-5m-5 5 5 5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>,
    document.body,
  )
}
