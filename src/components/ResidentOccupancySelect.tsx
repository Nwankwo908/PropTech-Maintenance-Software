import { RESIDENT_OCCUPANCY_OPTIONS, type ResidentOccupancyStatus } from '@/lib/residentOccupancy'

type ResidentOccupancySelectProps = {
  value: ResidentOccupancyStatus
  onChange: (value: ResidentOccupancyStatus) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

/** Occupancy dropdown used on AI review and the resident profile. */
export function ResidentOccupancySelect({
  value,
  onChange,
  disabled = false,
  id,
  'aria-label': ariaLabel = 'Occupancy status',
  className,
}: ResidentOccupancySelectProps) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value as ResidentOccupancyStatus)}
      >
        {RESIDENT_OCCUPANCY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-4">
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </span>
    </div>
  )
}
