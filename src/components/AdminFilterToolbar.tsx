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
}

/** Filter chips on the left, expanded filter trigger on the right. */
export function AdminFilterToolbar<T extends string>({
  options,
  activeFilters,
  onToggle,
  onClear,
}: AdminFilterToolbarProps<T>) {
  return (
    <div className="flex items-center gap-4 border-b border-[#e5e7eb] px-6 py-3">
      <AdminActiveFilterChips
        options={options}
        activeFilters={activeFilters}
        onRemove={onToggle}
      />
      <AdminCheckboxFilterDropdown
        className="min-w-[140px] flex-1"
        options={options}
        activeFilters={activeFilters}
        onToggle={onToggle}
        onClear={onClear}
      />
    </div>
  )
}
