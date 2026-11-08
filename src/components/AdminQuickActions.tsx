import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { adminNavPath } from '@/lib/adminNavigation'

const ACTIONS = [
  { id: 'resident', label: 'Add resident', path: adminNavPath('residents') },
  { id: 'vendor', label: 'Add vendor', path: adminNavPath('vendors') },
  { id: 'property', label: 'Add property', path: adminNavPath('properties') },
] as const

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={['size-4 transition-transform', open ? 'rotate-180' : ''].join(' ')}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Top-bar menu that opens the existing add-resident, add-vendor, or add-property form. */
export function AdminQuickActions({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(path: string) {
    setOpen(false)
    const next = new URLSearchParams(location.pathname === path ? location.search : '')
    next.set('add', '1')
    navigate({ pathname: path, search: `?${next.toString()}` })
  }

  const height = compact ? 'h-8' : 'h-9'
  const text = compact ? 'text-[13px]' : 'text-[14px]'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <div className={['inline-flex items-stretch overflow-hidden rounded-[10px] bg-[#186179] text-white', height].join(' ')}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
          className={[
            'sa-press cursor-pointer bg-[#186179] px-3 font-medium leading-5 outline-none hover:bg-[#14566b] focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2',
            text,
          ].join(' ')}
        >
          Quick actions
        </button>
        <button
          type="button"
          aria-label="Open quick actions"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
          className="sa-press flex cursor-pointer items-center border-l border-white/30 bg-[#186179] px-2 outline-none hover:bg-[#14566b] focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2"
        >
          <ChevronDown open={open} />
        </button>
      </div>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0px_8px_24px_rgba(16,24,40,0.12)]"
        >
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => choose(action.path)}
              className="block w-full cursor-pointer px-3 py-2 text-left text-[14px] leading-5 text-[#101828] outline-none hover:bg-[#f3f4f6] focus-visible:bg-[#f3f4f6]"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
