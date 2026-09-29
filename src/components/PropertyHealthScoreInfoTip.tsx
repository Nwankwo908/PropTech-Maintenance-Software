import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import feedInfoIcon from '@/assets/noun-information.png'
import {
  PROPERTY_HEALTH_SCORE_INFO_DESCRIPTION,
  type PropertyHealthFactorBreakdownLine,
} from '@/lib/propertyHealth'

function KpiInfoIcon() {
  return (
    <img src={feedInfoIcon} alt="" aria-hidden className="size-4 opacity-55" />
  )
}

/** Property Health KPI ⓘ — intro + Factor / Status / What it means table, portaled over the card. */
export function PropertyHealthScoreInfoTip({
  lines,
}: {
  lines: PropertyHealthFactorBreakdownLine[]
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 24)
    let left = rect.right - width
    if (left < 12) left = 12
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12)
    }
    setCoords({ top: rect.bottom + 6, left })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePosition()
    const onReposition = () => updatePosition()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, updatePosition])

  if (!lines.length) return null

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => {
        updatePosition()
        setOpen(true)
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        tabIndex={0}
        className="sa-press inline-flex rounded p-0.5 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
        aria-label="Property health score factors"
        aria-expanded={open}
        onFocus={() => {
          updatePosition()
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
      >
        <KpiInfoIcon />
      </button>
      {open && coords
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[80] rounded-[10px] border border-[#e5e7eb] bg-white p-3 shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
              style={{
                top: coords.top,
                left: coords.left,
                width: `min(340px, calc(100vw - 1.5rem))`,
              }}
            >
              <p className="text-[12px] leading-[17px] text-[#0a0a0a]">
                {PROPERTY_HEALTH_SCORE_INFO_DESCRIPTION}
              </p>
              <table className="mt-2.5 w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e5e7eb]">
                    <th className="pb-1.5 pr-2 text-[11px] font-semibold leading-4 text-[#0a0a0a]">
                      Factor
                    </th>
                    <th className="pb-1.5 pr-2 text-[11px] font-semibold leading-4 text-[#0a0a0a]">
                      Status
                    </th>
                    <th className="pb-1.5 text-[11px] font-semibold leading-4 text-[#0a0a0a]">
                      What it means
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.label} className="border-b border-[#e5e7eb] last:border-b-0">
                      <td className="py-1.5 pr-2 align-top text-[11px] font-medium leading-4 text-[#0a0a0a]">
                        {line.label}
                      </td>
                      <td className="py-1.5 pr-2 align-top text-[11px] leading-4 tabular-nums text-[#0a0a0a]">
                        {line.value}
                      </td>
                      <td className="py-1.5 align-top text-[11px] leading-4 text-[#0a0a0a]">
                        {line.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
