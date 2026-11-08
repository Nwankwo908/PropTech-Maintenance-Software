import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'

export type ThreeDotMenuItem = {
  id: string
  label: string
  onSelect: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

type ThreeDotMenuProps = {
  ariaLabel: string
  items: ThreeDotMenuItem[]
  /** Controlled open state (e.g. setup-success coachmark). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerRef?: Ref<HTMLButtonElement>
  /** Draw the menu in a fixed layer so a scrolling thread does not clip it. */
  floatMenu?: boolean
}

function DotsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  )
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else ref.current = value
}

/** Compact ⋯ overflow menu (property cards, list rows). */
export function ThreeDotMenu({
  ariaLabel,
  items,
  open: openProp,
  onOpenChange,
  triggerRef,
  floatMenu = false,
}: ThreeDotMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolledOpen

  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      style={floatMenu && menuBox ? { top: menuBox.top, left: menuBox.left } : undefined}
      className={[
        'sa-enter overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]',
        floatMenu ? 'fixed z-[80] min-w-[180px]' : 'absolute right-0 z-20 mt-1 min-w-[140px]',
      ].join(' ')}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          ref={(node) => assignRef(item.buttonRef, node)}
          className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
          onClick={() => {
            setOpen(false)
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        ref={(node) => {
          buttonRef.current = node
          assignRef(triggerRef, node)
        }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          if (floatMenu && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect()
            const menuHeight = 44
            const below = rect.bottom + 4
            const top =
              below + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 4) : below
            setMenuBox({ top, left: rect.left })
          }
          setOpen(true)
        }}
        className="sa-press inline-flex size-7 items-center justify-center rounded-[8px] text-[#6a7282] hover:bg-[#f3f4f6] hover:text-[#0a0a0a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
      >
        <DotsIcon />
      </button>
      {floatMenu && menu ? createPortal(menu, document.body) : menu}
    </div>
  )
}
