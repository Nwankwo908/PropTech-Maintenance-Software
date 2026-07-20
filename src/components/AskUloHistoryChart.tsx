import { useId, useMemo, useState } from 'react'

export type AskUloHistoryChartSeriesPoint = {
  date: string
  value: number
}

type AskUloHistoryChartProps = {
  title: string
  changeLabel: string | null
  valueKind: 'value' | 'rent'
  series: AskUloHistoryChartSeriesPoint[]
  buildingName?: string | null
}

function parseUtc(iso: string): number {
  return new Date(iso.includes('T') ? iso : `${iso}T12:00:00Z`).getTime()
}

function formatAxisValue(n: number, valueKind: 'value' | 'rent'): string {
  if (valueKind === 'rent') {
    if (n >= 1000) return `$${Math.round(n / 100) / 10}K`
    return `$${Math.round(n)}`
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}

function formatTooltipValue(n: number, valueKind: 'value' | 'rent'): string {
  if (valueKind === 'rent') return `$${Math.round(n).toLocaleString('en-US')}/mo`
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `$${m.toFixed(2)}M`
  }
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const span = max - min
  const raw = span / Math.max(1, count - 1)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const niceMin = Math.floor(min / niceStep) * niceStep
  const ticks: number[] = []
  for (let v = niceMin; v <= max + niceStep * 0.01; v += niceStep) {
    ticks.push(v)
    if (ticks.length > 8) break
  }
  return ticks
}

function yearTicks(startMs: number, endMs: number): number[] {
  const startY = new Date(startMs).getUTCFullYear()
  const endY = new Date(endMs).getUTCFullYear()
  const years: number[] = []
  // Prefer even years like the Zillow reference when span is long.
  const step = endY - startY >= 8 ? 2 : 1
  const first = startY % step === 0 ? startY : startY + (step - (startY % step))
  for (let y = first; y <= endY; y += step) years.push(y)
  if (years.length === 0) years.push(endY)
  return years
}

/**
 * Zestimate-style value / rent history chart for Ask Ulo (SVG, no chart library).
 */
export function AskUloHistoryChart({
  title,
  changeLabel,
  valueKind,
  series,
  buildingName,
}: AskUloHistoryChartProps) {
  const gradId = useId().replace(/:/g, '')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const points = useMemo(
    () =>
      series
        .filter((p) => Number.isFinite(p.value) && p.date)
        .map((p) => ({ t: parseUtc(p.date), value: p.value, date: p.date }))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t),
    [series],
  )

  if (points.length < 2) return null

  const width = 560
  const height = 280
  const padL = 12
  const padR = 56
  const padT = 16
  const padB = 36
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const minT = points[0].t
  const maxT = points[points.length - 1].t
  const values = points.map((p) => p.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin) * 0.12 || rawMax * 0.05
  const minV = Math.max(0, rawMin - pad)
  const maxV = rawMax + pad

  const xAt = (t: number) => padL + ((t - minT) / (maxT - minT || 1)) * plotW
  const yAt = (v: number) => padT + (1 - (v - minV) / (maxV - minV || 1)) * plotH

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.t).toFixed(2)} ${yAt(p.value).toFixed(2)}`)
    .join(' ')

  const yTicks = niceTicks(minV, maxV, 6)
  const xYears = yearTicks(minT, maxT)
  const start = points[0]
  const end = points[points.length - 1]
  const hi = hoverIdx != null ? points[hoverIdx] : null

  const lineColor = '#16a34a'
  const gridColor = '#e5e7eb'

  return (
    <section className="mt-1 mb-4">
      <h2 className="text-[16px] font-semibold leading-5 tracking-[-0.2px] text-[#0a0a0a]">
        {title}
      </h2>
      {buildingName ? (
        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{buildingName}</p>
      ) : null}
      {changeLabel ? (
        <p className="mt-1 text-[14px] font-medium leading-5 text-[#16a34a]">{changeLabel}</p>
      ) : null}

      <div className="relative mt-3 w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}${changeLabel ? `: ${changeLabel}` : ''}`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.12" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal grid + right Y labels */}
          {yTicks.map((v) => {
            const y = yAt(v)
            return (
              <g key={`y-${v}`}>
                <line
                  x1={padL}
                  x2={padL + plotW}
                  y1={y}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth={1}
                />
                <text
                  x={width - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[#6a7282]"
                  style={{ fontSize: 11, fontFamily: 'system-ui, sans-serif' }}
                >
                  {formatAxisValue(v, valueKind)}
                </text>
              </g>
            )
          })}

          {/* Vertical grid + year labels */}
          {xYears.map((year) => {
            const t = Date.UTC(year, 0, 1)
            if (t < minT - 86400000 * 60 || t > maxT + 86400000 * 60) return null
            const x = xAt(Math.min(maxT, Math.max(minT, t)))
            return (
              <g key={`x-${year}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={padT}
                  y2={padT + plotH}
                  stroke={gridColor}
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-[#6a7282]"
                  style={{ fontSize: 11, fontFamily: 'system-ui, sans-serif' }}
                >
                  {year}
                </text>
              </g>
            )
          })}

          {/* Area under line */}
          <path
            d={`${pathD} L ${xAt(end.t).toFixed(2)} ${(padT + plotH).toFixed(2)} L ${xAt(start.t).toFixed(2)} ${(padT + plotH).toFixed(2)} Z`}
            fill={`url(#fill-${gradId})`}
          />

          <path d={pathD} fill="none" stroke={lineColor} strokeWidth={3} strokeLinejoin="round" />

          {/* Start $ badge */}
          <g transform={`translate(${xAt(start.t)}, ${yAt(start.value)})`}>
            <circle r={11} fill={lineColor} />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              style={{ fontSize: 12, fontWeight: 700, fontFamily: 'system-ui, sans-serif' }}
            >
              $
            </text>
          </g>

          {/* End dot */}
          <circle cx={xAt(end.t)} cy={yAt(end.value)} r={5} fill={lineColor} />

          {/* Hover crosshair */}
          {hi ? (
            <g>
              <line
                x1={xAt(hi.t)}
                x2={xAt(hi.t)}
                y1={padT}
                y2={padT + plotH}
                stroke="#9ca3af"
                strokeDasharray="3 3"
              />
              <circle cx={xAt(hi.t)} cy={yAt(hi.value)} r={4.5} fill={lineColor} stroke="#fff" strokeWidth={2} />
            </g>
          ) : null}

          {/* Invisible hit targets */}
          {points.map((p, i) => (
            <circle
              key={p.date}
              cx={xAt(p.t)}
              cy={yAt(p.value)}
              r={10}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}
        </svg>

        {hi ? (
          <div className="pointer-events-none absolute left-3 top-2 rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] shadow-sm">
            <div className="font-semibold text-[#0a0a0a]">
              {formatTooltipValue(hi.value, valueKind)}
            </div>
            <div className="text-[#6a7282]">
              {new Date(hi.t).toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
