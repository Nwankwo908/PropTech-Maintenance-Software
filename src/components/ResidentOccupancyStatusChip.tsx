import {
  normalizeResidentOccupancyStatus,
  residentOccupancyChipVisualClasses,
  residentOccupancyLabel,
  type ResidentOccupancyStatus,
} from '@/lib/residentOccupancy'

/** Compact occupancy / lease-status pill for resident profile and lists. */
export function ResidentOccupancyStatusChip({
  status,
  className = '',
}: {
  status: ResidentOccupancyStatus | string | null | undefined
  className?: string
}) {
  const normalized = normalizeResidentOccupancyStatus(status)
  const styles = residentOccupancyChipVisualClasses(normalized)
  const label = residentOccupancyLabel(normalized)
  return (
    <span
      className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${styles.pill} ${className}`.trim()}
      title={label}
    >
      <span className={`inline-block size-2 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  )
}
