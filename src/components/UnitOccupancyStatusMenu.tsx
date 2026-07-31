import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropertyUnitOccupancyStatus } from '@/lib/propertyUnitRows'

export type UnitOccupancyStatus = PropertyUnitOccupancyStatus

const MENU_WIDTH = 180
const MENU_GAP = 6

const STATUS_OPTIONS: Array<{
  value: UnitOccupancyStatus
  label: string
  dotClassName: string
}> = [
  { value: 'occupied', label: 'Occupied', dotClassName: 'bg-[#22c55e]' },
  { value: 'vacant', label: 'Vacant', dotClassName: 'bg-[#4a5565]' },
  {
    value: 'under_maintenance',
    label: 'Under maintenance',
    dotClassName: 'bg-[#f97316]',
  },
]

const CHIP_STYLES: Record<UnitOccupancyStatus, string> = {
  occupied: 'bg-[#dcfce7] text-[#008236]',
  vacant: 'bg-[#f3f4f6] text-[#6a7282]',
  under_maintenance: 'bg-[#ffedd5] text-[#c2410c]',
}

const CHIP_LABELS: Record<UnitOccupancyStatus, string> = {
  occupied: 'Occupied',
  vacant: 'Vacant',
  under_maintenance: 'Under maintenance',
}

function CheckIcon() {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2.5 6.2 4.8 8.5 9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type MenuCoords = {
  top: number
  left: number
}

type UnitOccupancyStatusMenuProps = {
  status: UnitOccupancyStatus
  onStatusChange?: (status: UnitOccupancyStatus) => void
  disabled?: boolean
}

/** Property Units status chip + Figma Status-Dropdown-Popover (node 1079:774). */
export function UnitOccupancyStatusMenu({
  status,
  onStatusChange,
  disabled = false,
}: UnitOccupancyStatusMenuProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<MenuCoords>({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  function measurePosition(): MenuCoords {
    const button = buttonRef.current
    if (!button) return { top: 0, left: 0 }

    const rect = button.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 112
    const viewportPadding = 8
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP
    const openUpward = spaceBelow < menuHeight && rect.top > spaceBelow

    const top = openUpward
      ? Math.max(viewportPadding, rect.top - MENU_GAP - menuHeight)
      : Math.min(
          window.innerHeight - menuHeight - viewportPadding,
          rect.bottom + MENU_GAP,
        )
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - MENU_WIDTH - viewportPadding,
    )

    return { top, left }
  }

  useLayoutEffect(() => {
    if (!open) return

    function updatePosition() {
      setCoords(measurePosition())
    }

    updatePosition()
    // Remeasure after paint so menu height is accurate for flip/clamp.
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  function handleSelect(next: UnitOccupancyStatus) {
    setOpen(false)
    if (next === status) return
    onStatusChange?.(next)
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label="Unit status"
          style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
          className="fixed z-[100] flex flex-col gap-0.5 rounded-[10px] border border-[#eceff1] bg-white p-1.5 shadow-[0px_8px_8px_rgba(0,0,0,0.07)]"
        >
          {STATUS_OPTIONS.map((option) => {
            const selected = option.value === status
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(option.value)}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#1e56a0]/40 ${
                  selected
                    ? 'bg-[#f4f7fa] text-[#1e56a0]'
                    : 'text-[#1a1d20] hover:bg-[#f8fafc]'
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${option.dotClassName}`}
                  aria-hidden
                />
                <span
                  className={`min-w-0 flex-1 text-[13px] leading-none ${
                    selected ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {option.label}
                </span>
                {selected ? <CheckIcon /> : null}
              </button>
            )
          })}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (!open) setCoords(measurePosition())
          setOpen((value) => !value)
        }}
        className={`inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#1e56a0] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${CHIP_STYLES[status]} ${
          open ? 'ring-2 ring-[#1e56a0]/30 ring-offset-1' : ''
        }`}
      >
        {CHIP_LABELS[status]}
      </button>
      {menu}
    </div>
  )
}
