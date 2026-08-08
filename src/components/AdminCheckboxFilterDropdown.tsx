import { useEffect, useId, useRef, useState } from 'react'
import { ADMIN_FILTER_TRIGGER_CLASS } from '@/components/AdminActiveFilterChips'
import { checkboxInputClassName } from '@/components/TableCheckbox'

export type AdminCheckboxFilterOption<T extends string> = {
  id: T
  label: string
}

type AdminCheckboxFilterDropdownProps<T extends string> = {
  options: readonly AdminCheckboxFilterOption<T>[]
  activeFilters: Set<T>
  onToggle: (key: T) => void
  onClear: () => void
  className?: string
}

/** Shared multi-select checkbox filter — Active Tasks, Messages, etc. */
export function AdminCheckboxFilterDropdown<T extends string>({
  options,
  activeFilters,
  onToggle,
  onClear,
  className = '',
}: AdminCheckboxFilterDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  return (
    <div ref={rootRef} className={['relative', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={`${ADMIN_FILTER_TRIGGER_CLASS} w-full justify-between`}
      >
        Filter
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-20 mt-1.5 min-w-[200px] rounded-[10px] border border-[#e5e7eb] bg-white p-1.5 shadow-lg"
        >
          {options.map((option) => {
            const checked = activeFilters.has(option.id)
            return (
              <label
                key={option.id}
                role="option"
                aria-selected={checked}
                className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 hover:bg-[#f9fafb]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(option.id)}
                  className={checkboxInputClassName}
                  aria-label={option.label}
                />
                <span className="text-[13px] font-medium text-[#364153]">{option.label}</span>
              </label>
            )
          })}
          {activeFilters.size > 0 ? (
            <div className="mt-1 border-t border-[#e5e7eb] pt-1">
              <button
                type="button"
                onClick={() => {
                  onClear()
                  setOpen(false)
                }}
                className="sa-press w-full cursor-pointer rounded-[8px] px-2.5 py-2 text-left text-[12px] font-medium text-[#6a7282] hover:bg-[#f9fafb] hover:text-[#364153]"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
