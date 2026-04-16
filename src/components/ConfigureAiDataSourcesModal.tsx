import { useEffect, useId, useState } from 'react'
import { SparkleIcon } from '@/components/SparkleIcon'

const SOURCE_IDS = [
  'maintenance-history',
  'vendor-performance',
  'resident-feedback',
  'pms-integration',
  'weather-seasonal',
  'training-library',
] as const

type SourceId = (typeof SOURCE_IDS)[number]

const SOURCE_META: Record<
  SourceId,
  {
    emoji: string
    title: string
    description: string
    metaA: string
    metaB: string
    recommended?: boolean
  }
> = {
  'maintenance-history': {
    emoji: '📋',
    title: 'Maintenance History',
    description: 'Past repair records, recurring issues, and resolution patterns',
    metaA: '📊 2,847 records',
    metaB: '🔄 Updated daily',
    recommended: true,
  },
  'vendor-performance': {
    emoji: '⭐',
    title: 'Vendor Performance',
    description: 'Ratings, response times, completion rates, and cost efficiency',
    metaA: '📊 23 vendors',
    metaB: '🔄 Real-time',
    recommended: true,
  },
  'resident-feedback': {
    emoji: '💬',
    title: 'Resident Feedback',
    description: 'Post-service surveys, satisfaction scores, and complaint history',
    metaA: '📊 1,234 responses',
    metaB: '🔄 Updated weekly',
    recommended: true,
  },
  'pms-integration': {
    emoji: '🏢',
    title: 'PMS Integration',
    description: 'Property details, unit information, lease terms, and occupancy',
    metaA: '📊 156 units',
    metaB: '🔄 Synced hourly',
  },
  'weather-seasonal': {
    emoji: '🌤️',
    title: 'Weather & Seasonal Data',
    description: 'Local weather patterns, seasonal trends, and predictive maintenance alerts',
    metaA: '📊 External API',
    metaB: '🔄 Live updates',
  },
  'training-library': {
    emoji: '📚',
    title: 'Training Data Library',
    description: 'Industry best practices, equipment manuals, and troubleshooting guides',
    metaA: '📊 50k+ documents',
    metaB: '🔄 Updated monthly',
  },
}

const PRIORITY_ROWS: { key: string; label: string; pct: number }[] = [
  { key: 'mh', label: 'Maintenance History', pct: 40 },
  { key: 'vp', label: 'Vendor Performance', pct: 30 },
  { key: 'rf', label: 'Resident Feedback', pct: 20 },
  { key: 'os', label: 'Other Sources', pct: 10 },
]

const CONFIDENCE_OPTIONS = ['70%', '75%', '80%', '85%', '90%'] as const

function SourceCheckbox({
  checked,
  className = '',
}: {
  checked: boolean
  className?: string
}) {
  return (
    <span
      className={[
        'flex size-5 shrink-0 items-center justify-center rounded border-2',
        checked
          ? 'border-[#ad46ff] bg-[#ad46ff]'
          : 'border-[#d1d5dc] bg-white',
        className,
      ].join(' ')}
      aria-hidden
    >
      {checked ? (
        <svg className="size-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  )
}

function ToggleRow({
  on,
  onToggle,
  label,
  hint,
  labelId,
}: {
  on: boolean
  onToggle: () => void
  label: string
  hint: string
  labelId: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#e5e7eb] px-3 py-3">
      <div className="min-w-0" id={labelId}>
        <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">{label}</p>
        <p className="text-[12px] leading-4 text-[#6a7282]">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        onClick={onToggle}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2',
          on ? 'bg-[#9810fa]' : 'bg-[#d1d5dc]',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-0.5 size-4 rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-6' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

/** Modal content from Figma 87:11514 — Configure AI Data Sources. */
export function ConfigureAiDataSourcesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()
  const learningLabelId = useId()
  const anomalyLabelId = useId()

  const [selected, setSelected] = useState<Set<SourceId>>(
    () => new Set<SourceId>(['maintenance-history']),
  )
  const [realtimeLearning, setRealtimeLearning] = useState(true)
  const [anomalyDetection, setAnomalyDetection] = useState(true)
  const [confidence, setConfidence] = useState<(typeof CONFIDENCE_OPTIONS)[number]>('85%')

  const selectedCount = selected.size
  const allSelected = selectedCount === SOURCE_IDS.length

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setSelected(new Set(['maintenance-history']))
      setRealtimeLearning(true)
      setAnomalyDetection(true)
      setConfidence('85%')
    }
  }

  if (!open) return null

  function toggleSource(id: SourceId) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (allSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(SOURCE_IDS))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92dvh,900px)] w-full max-w-[1009px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3e8ff] text-[#9810fa]">
              <SparkleIcon className="size-5" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Configure AI Data Sources
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Manage where the AI pulls insights and makes decisions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            <div className="rounded-[10px] border-l-4 border-[#2b7fff] bg-[#eff6ff] py-4 pl-5 pr-4">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-[#1447e6]" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                  <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#1c398e]">
                    AI Learning System
                  </p>
                  <p className="mt-1 text-[12px] leading-4 text-[#1447e6]">
                    The AI analyzes selected data sources to improve vendor recommendations, urgency detection,
                    and routing efficiency. More sources = better accuracy.
                  </p>
                </div>
              </div>
            </div>

            <section className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                    Active Data Sources{' '}
                    <span className="text-[#99a1af]">({selectedCount} selected)</span>
                  </p>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2"
                  >
                    Select All
                  </button>
                </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {SOURCE_IDS.map((id) => {
                  const meta = SOURCE_META[id]
                  const isOn = selected.has(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSource(id)}
                      className={[
                        'flex gap-3 rounded-[10px] border-2 p-[18px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2',
                        isOn ? 'border-[#ad46ff] bg-[#faf5ff]' : 'border-[#e5e7eb] bg-white hover:bg-[#fafafa]',
                      ].join(' ')}
                    >
                      <SourceCheckbox checked={isOn} className="mt-0.5" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[18px] leading-7" aria-hidden>
                            {meta.emoji}
                          </span>
                          <span className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                            {meta.title}
                          </span>
                          {meta.recommended ? (
                            <span className="inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 bg-[#dcfce7] text-[#008236]">
                              Recommended
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[12px] leading-4 text-[#4a5565]">{meta.description}</p>
                        <div className="flex flex-wrap gap-4 text-[12px] leading-4 text-[#6a7282]">
                          <span>{meta.metaA}</span>
                          <span>{meta.metaB}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Source Priority Weighting
              </h3>
              <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[17px] py-[17px]">
                <p className="text-[12px] leading-4 text-[#4a5565]">
                  Adjust how much the AI should prioritize each data source when making decisions.
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  {PRIORITY_ROWS.map((row) => (
                    <div key={row.key} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">{row.label}</span>
                        <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#9810fa]">
                          {row.pct}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-[10px] bg-[#e5e7eb]">
                        <div
                          className="h-full rounded-[10px] bg-[#9810fa]"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Advanced Settings
              </h3>
              <div className="flex flex-col gap-3">
                <ToggleRow
                  labelId={learningLabelId}
                  label="Real-time Learning"
                  hint="AI adapts immediately from new data"
                  on={realtimeLearning}
                  onToggle={() => setRealtimeLearning((v) => !v)}
                />
                <ToggleRow
                  labelId={anomalyLabelId}
                  label="Anomaly Detection"
                  hint="Flag unusual patterns for manual review"
                  on={anomalyDetection}
                  onToggle={() => setAnomalyDetection((v) => !v)}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#e5e7eb] px-[13px] py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      Confidence Threshold
                    </p>
                    <p className="text-[12px] leading-4 text-[#6a7282]">
                      Minimum AI confidence for auto-routing (currently {confidence})
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <select
                      value={confidence}
                      onChange={(e) =>
                        setConfidence(e.target.value as (typeof CONFIDENCE_OPTIONS)[number])
                      }
                      aria-label="Confidence threshold"
                      className="h-9 w-[96px] appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-8 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#9810fa]/45 focus:ring-2 focus:ring-[#9810fa]/30"
                    >
                      {CONFIDENCE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <div className="rounded-[10px] border-l-4 border-[#00c950] bg-[#f0fdf4] py-4 pl-5 pr-4">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-[#00a63e]" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M4 19h16M7 15l3-4 4 5 5-9"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0d542b]">
                    Estimated Impact
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-[12px] leading-4 text-[#008236]">
                    <li>✓ AI recommendation accuracy: 94% → 96%</li>
                    <li>✓ Average response time: 4.2hrs → 3.8hrs</li>
                    <li>✓ Vendor match quality: 89% → 92%</li>
                    <li>✓ Data processing load: +12% (acceptable)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#9810fa] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#8610de] focus-visible:ring-2 focus-visible:ring-[#9810fa] focus-visible:ring-offset-2"
          >
            <svg className="size-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Save Configuration
          </button>
        </footer>
      </div>
    </div>
  )
}
