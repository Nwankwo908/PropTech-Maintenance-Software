import type { ReactNode } from 'react'
import { AdminActiveFilterChips } from '@/components/AdminActiveFilterChips'
import {
  AdminCheckboxFilterDropdown,
  type AdminCheckboxFilterOption,
} from '@/components/AdminCheckboxFilterDropdown'

type AdminFilterToolbarProps<T extends string> = {
  options: readonly AdminCheckboxFilterOption<T>[]
  activeFilters: Set<T>
  onToggle: (key: T) => void
  onClear: () => void
  /** Optional search field on the same row as the filter control. */
  search?: ReactNode
  /** Optional actions on the same row (e.g. bulk Delete). */
  trailing?: ReactNode
}

/** Filter chips on the left, expanded filter trigger on the right. */
export function AdminFilterToolbar<T extends string>({
  options,
  activeFilters,
  onToggle,
  onClear,
  search,
  trailing,
}: AdminFilterToolbarProps<T>) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e7eb] px-6 py-3 sm:gap-4">
      {search ? <div className="min-w-0 w-full flex-1 sm:min-w-[220px] sm:max-w-md">{search}</div> : null}
      <AdminActiveFilterChips
        options={options}
        activeFilters={activeFilters}
        onRemove={onToggle}
      />
      <AdminCheckboxFilterDropdown
        className={search ? 'min-w-[140px] shrink-0' : 'min-w-[140px] flex-1'}
        options={options}
        activeFilters={activeFilters}
        onToggle={onToggle}
        onClear={onClear}
      />
      {trailing ? <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  )
}
