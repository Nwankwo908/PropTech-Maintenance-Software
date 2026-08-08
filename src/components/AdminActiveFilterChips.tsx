export const ADMIN_FILTER_CHIP_CLASS =
  'sa-press inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-[#f3f4f6] px-3 py-1.5 text-[13px] font-medium text-[#364153] hover:bg-[#e5e7eb]'

export const ADMIN_FILTER_TRIGGER_CLASS =
  'sa-press inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-medium text-[#364153] hover:bg-[#f9fafb]'

function FilterChipRemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

type AdminActiveFilterChipsProps<T extends string> = {
  options: readonly { id: T; label: string }[]
  activeFilters: Set<T>
  onRemove: (id: T) => void
}

/** Selected filter labels shown beside the filter dropdown (Active Tasks, Messages, etc.). */
export function AdminActiveFilterChips<T extends string>({
  options,
  activeFilters,
  onRemove,
}: AdminActiveFilterChipsProps<T>) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {options
        .filter((option) => activeFilters.has(option.id))
        .map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onRemove(option.id)}
            className={ADMIN_FILTER_CHIP_CLASS}
            aria-label={`Remove ${option.label} filter`}
          >
            {option.label}
            <FilterChipRemoveIcon />
          </button>
        ))}
    </div>
  )
}
