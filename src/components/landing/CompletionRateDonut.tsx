type CompletionRateDonutProps = {
  percent: number
  sizeClassName?: string
}

export function CompletionRateDonut({ percent, sizeClassName = 'size-11' }: CompletionRateDonutProps) {
  const clamped = Math.min(100, Math.max(0, percent))
  const pct = clamped / 100
  const r = 18
  const stroke = 5
  const circumference = 2 * Math.PI * r
  const dash = pct * circumference
  const viewBox = 44
  const cx = viewBox / 2

  return (
    <div
      className={`relative shrink-0 ${sizeClassName}`}
      role="img"
      aria-label={`${clamped}% completion rate`}
    >
      <svg className="size-full -rotate-90" viewBox={`0 0 ${viewBox} ${viewBox}`} aria-hidden>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[9px] font-bold leading-none text-[#0e5c45]">{clamped}%</span>
      </div>
    </div>
  )
}
