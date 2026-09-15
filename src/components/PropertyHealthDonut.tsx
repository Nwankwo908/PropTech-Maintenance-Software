/**
 * Property Health donut — Figma 1469:862 (thick periwinkle ring, light track, round caps).
 */

export const PROPERTY_HEALTH_DONUT_FILL = '#5B6CFF'
export const PROPERTY_HEALTH_DONUT_TRACK = '#F3F4F6'

const VIEW = 184
const STROKE = 22
const RADIUS = 70

export function propertyHealthDonutPercent(
  score: number | null | undefined,
  ready: boolean,
): number {
  if (!ready || score == null || !Number.isFinite(score)) return 0
  return Math.min(100, Math.max(0, score))
}

type PropertyHealthDonutProps = {
  percent: number
  label: string
  /** Score shown in the hole (e.g. 82% or —). */
  centerText?: string
  sizeClassName?: string
}

export function PropertyHealthDonut({
  percent,
  label,
  centerText,
  sizeClassName = 'size-24',
}: PropertyHealthDonutProps) {
  const clamped = propertyHealthDonutPercent(percent, true)
  const circumference = 2 * Math.PI * RADIUS
  const dash = (clamped / 100) * circumference
  const cx = VIEW / 2

  return (
    <div
      className={`relative shrink-0 ${sizeClassName}`}
      role="img"
      aria-label={label}
    >
      <svg
        className="size-full -rotate-90"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cx}
          r={RADIUS}
          fill="none"
          stroke={PROPERTY_HEALTH_DONUT_TRACK}
          strokeWidth={STROKE}
        />
        {dash > 0 ? (
          <circle
            cx={cx}
            cy={cx}
            r={RADIUS}
            fill="none"
            stroke={PROPERTY_HEALTH_DONUT_FILL}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        ) : null}
      </svg>
      {centerText ? (
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-1 text-center text-[15px] font-medium leading-none tracking-[0.2px] text-[#0a0a0a] tabular-nums"
          aria-hidden
        >
          {centerText}
        </span>
      ) : null}
    </div>
  )
}
