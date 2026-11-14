import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { askStaffMetrics, fetchStaffMetrics, type StaffMetrics, type StaffMetricsAnswer } from '@/api/staffMetrics'
import { AskUloMarkdown } from '@/components/AskUloMarkdown'
import { isSessionPlatformStaff } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  STAFF_METRIC_DEFINITIONS,
  STAFF_METRIC_SECTIONS,
  STAFF_METRICS_WINDOWS,
  formatStaffMetric,
  readStaffMetric,
  type StaffMetricDefinition,
} from '@shared/staffMetrics/catalog'

const EXAMPLE_QUESTIONS = [
  'How many work orders are overdue right now?',
  'What is our vendor acceptance rate?',
  'How much rent was collected online?',
  'Are any scheduled jobs missing?',
] as const

/** Metrics shown as "needs attention" chips when above zero. */
const ATTENTION_PATHS = [
  'maintenance.overdue_now',
  'maintenance.needs_staff_now',
  'maintenance.stalled_now',
  'money.invoices_waiting_count',
  'sms.residents_activation_failed',
  'data_health.required_crons_missing',
  'data_health.required_cron_failed_runs_24h',
  'data_health.unit_mismatch_findings_7d',
  'data_health.work_orders_missing_property',
] as const

type WeeklyPoint = { week_start: string; created: number; completed: number }
type TradeRow = { trade: string; created: number }
type CronRow = { jobname: string; status: string; scheduled: boolean | null; failed_runs_24h: number | null }

function readArray<T>(metrics: StaffMetrics | null, section: string, key: string): T[] {
  const group = metrics?.[section]
  if (!group || typeof group !== 'object' || Array.isArray(group)) return []
  const value = (group as Record<string, unknown>)[key]
  return Array.isArray(value) ? (value as T[]) : []
}

function tradeLabel(trade: string): string {
  if (trade.toLowerCase() === 'hvac') return 'HVAC'
  const words = trade.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other'
}

function definitionByPath(path: string): StaffMetricDefinition | undefined {
  return STAFF_METRIC_DEFINITIONS.find((metric) => metric.path === path)
}

function MetricTile({
  metric,
  metrics,
  windowDays,
}: {
  metric: StaffMetricDefinition
  metrics: StaffMetrics | null
  windowDays: number
}) {
  const value = readStaffMetric(metrics, metric.path)
  const flagged = metric.higherIsWorse === true && metric.snapshot === true && (value ?? 0) > 0
  return (
    <div
      className={[
        'flex min-w-0 flex-col gap-1 rounded-[10px] border bg-white px-4 py-3',
        flagged ? 'border-[#fecaca]' : 'border-[#e5e7eb]',
      ].join(' ')}
    >
      <p className="text-[13px] leading-5 text-[#6a7282]">{metric.label}</p>
      <p
        className={[
          'text-[26px] font-medium leading-8 tabular-nums',
          flagged ? 'text-[#c10007]' : 'text-[#0a0a0a]',
        ].join(' ')}
      >
        {formatStaffMetric(value, metric.format)}
      </p>
      <p className="text-[12px] leading-4 text-[#6a7282]">
        <span className="font-medium text-[#364153]">{metric.snapshot ? 'Now' : `Last ${windowDays} days`}</span>
        {' · '}
        {metric.definition}
      </p>
    </div>
  )
}

function WeeklyChart({ points }: { points: WeeklyPoint[] }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.created, point.completed]))
  if (points.length === 0) return null
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-[#6a7282]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-[#364153]" /> Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-[#00a63e]" /> Completed
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-end gap-3" role="img" aria-label="Work orders created and completed per week">
          {points.map((point) => (
            <div key={point.week_start} className="flex w-12 flex-col items-center gap-1">
              <div className="flex h-32 items-end gap-1">
                <div
                  className="w-4 rounded-t-[3px] bg-[#364153]"
                  style={{ height: `${Math.round((point.created / max) * 100)}%` }}
                  title={`${point.created} created`}
                />
                <div
                  className="w-4 rounded-t-[3px] bg-[#00a63e]"
                  style={{ height: `${Math.round((point.completed / max) * 100)}%` }}
                  title={`${point.completed} completed`}
                />
              </div>
              <span className="text-[11px] tabular-nums text-[#6a7282]">{point.week_start.slice(5)}</span>
              <span className="text-[11px] tabular-nums text-[#364153]">
                {point.created}/{point.completed}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Funnel({ metrics }: { metrics: StaffMetrics | null }) {
  const steps = [
    'growth.funnel.signed_up',
    'growth.funnel.onboarding_completed',
    'growth.funnel.added_property',
    'growth.funnel.added_residents',
    'growth.funnel.activated_a_resident',
    'growth.funnel.first_work_order',
  ]
  const top = readStaffMetric(metrics, steps[0]) ?? 0
  const labels: Record<string, string> = { 'growth.funnel.signed_up': 'Signed up' }
  return (
    <ol className="mt-4 flex flex-col gap-2">
      {steps.map((path) => {
        const value = readStaffMetric(metrics, path) ?? 0
        const share = top > 0 ? value / top : 0
        return (
          <li key={path} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-[13px]">
            <span className="truncate text-[#364153]">{labels[path] ?? definitionByPath(path)?.label ?? path}</span>
            <span className="h-2.5 rounded-full bg-[#f3f4f6]">
              <span
                className="block h-2.5 rounded-full bg-[#364153]"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-[#0a0a0a]">
              {value}
              {top > 0 && path !== steps[0] ? (
                <span className="ml-1 text-[#6a7282]">({Math.round(share * 100)}%)</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function AdminStaffOpsDashboard() {
  const isStaff = isSessionPlatformStaff()
  const [days, setDays] = useState<number>(30)
  const [includeDemo, setIncludeDemo] = useState(false)
  const [metrics, setMetrics] = useState<StaffMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<StaffMetricsAnswer | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMetrics(await fetchStaffMetrics({ days, includeDemo }))
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load staff metrics.'))
    } finally {
      setLoading(false)
    }
  }, [days, includeDemo])

  useEffect(() => {
    if (isStaff) void load()
  }, [isStaff, load])

  const attention = useMemo(
    () =>
      ATTENTION_PATHS.map((path) => ({ path, metric: definitionByPath(path), value: readStaffMetric(metrics, path) }))
        .filter((row) => row.metric && (row.value ?? 0) > 0),
    [metrics],
  )

  async function submitQuestion(event?: FormEvent, override?: string) {
    event?.preventDefault()
    const text = (override ?? question).trim()
    if (!text) return
    if (override) setQuestion(override)
    setAsking(true)
    setAskError(null)
    try {
      setAnswer(await askStaffMetrics({ question: text, days, includeDemo }))
    } catch (err) {
      setAnswer(null)
      setAskError(getErrorMessage(err, 'Could not answer that right now.'))
    } finally {
      setAsking(false)
    }
  }

  if (!isStaff) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-[22px] font-semibold text-[#0a0a0a]">Ulo Ops is for Ulo staff</h1>
        <p className="mt-2 text-[14px] text-[#6a7282]">
          This page shows metrics across every landlord, so it is only available to Ulo staff accounts.
        </p>
      </div>
    )
  }

  const updated = typeof metrics?.generated_at === 'string' ? new Date(metrics.generated_at) : null

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-8 text-[#0a0a0a]">Ulo Ops</h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-5 text-[#6a7282]">
            Staff metrics across every landlord. Each number has one definition, shared with Ask Ulo below.
            {updated ? ` Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-[10px] border border-[#e5e7eb] bg-white p-1" role="group" aria-label="Time window">
            {STAFF_METRICS_WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                aria-pressed={days === option}
                className={[
                  'rounded-[8px] px-3 py-1.5 text-[13px] font-medium',
                  days === option ? 'bg-[#101828] text-white' : 'text-[#364153] hover:bg-[#f3f4f6]',
                ].join(' ')}
              >
                {option} days
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#364153]">
            <input
              id="staff-ops-include-demo"
              type="checkbox"
              checked={includeDemo}
              onChange={(event) => setIncludeDemo(event.target.checked)}
              className="size-4"
            />
            Include demo accounts
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#991b1b]">
          {error}
        </p>
      ) : null}

      <section className="rounded-[10px] border border-[#e5e7eb] bg-white px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#0a0a0a]">Needs attention now</h2>
        {loading && !metrics ? (
          <p className="mt-2 text-[13px] text-[#6a7282]">Loading…</p>
        ) : attention.length === 0 ? (
          <p className="mt-2 text-[13px] text-[#008236]">Nothing flagged. No overdue jobs, stuck jobs, failing texts or missing scheduled jobs.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {attention.map((row) => (
              <li
                key={row.path}
                className="rounded-full bg-[#fef2f2] px-3 py-1 text-[13px] text-[#991b1b]"
                title={row.metric?.definition}
              >
                {row.metric?.label}: <span className="font-semibold tabular-nums">{formatStaffMetric(row.value, row.metric!.format)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[10px] border border-[#e5e7eb] bg-white px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#0a0a0a]">Ask about these numbers</h2>
        <p className="mt-1 text-[13px] text-[#6a7282]">
          Answers come only from the metrics on this page, for the window you picked.
        </p>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void submitQuestion(event)}>
          <label htmlFor="staff-ops-question" className="sr-only">
            Question about staff metrics
          </label>
          <input
            id="staff-ops-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. How fast are vendors responding?"
            maxLength={500}
            className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#e5e7eb] px-3 text-[14px] outline-none focus:border-[#364153]"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="h-10 rounded-[10px] bg-[#101828] px-4 text-[14px] font-medium text-white disabled:opacity-50"
          >
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              disabled={asking}
              onClick={() => void submitQuestion(undefined, example)}
              className="rounded-full border border-[#e5e7eb] px-3 py-1 text-[12px] text-[#364153] hover:bg-[#f9fafb] disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
        {askError ? (
          <p role="alert" className="mt-3 text-[13px] text-[#991b1b]">
            {askError}
          </p>
        ) : null}
        {answer ? (
          <div className="mt-3 rounded-[10px] bg-[#f9fafb] px-4 py-3 text-[14px] text-[#0a0a0a]">
            <AskUloMarkdown content={answer.answer} />
            <p className="mt-2 text-[12px] text-[#6a7282]">
              {answer.source === 'ai' ? 'Written by Ask Ulo from the metrics above.' : 'Matched directly from the metrics above.'}
            </p>
          </div>
        ) : null}
      </section>

      {STAFF_METRIC_SECTIONS.map((section) => (
        <section key={section.id} className="rounded-[10px] border border-[#e5e7eb] bg-[#fcfcfd] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[#0a0a0a]">{section.title}</h2>
          <p className="mt-1 text-[13px] text-[#6a7282]">{section.summary}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {section.metrics
              .filter((metric) => !metric.path.startsWith('growth.funnel.'))
              .map((metric) => (
                <MetricTile key={metric.path} metric={metric} metrics={metrics} windowDays={days} />
              ))}
          </div>
          {section.id === 'growth' ? (
            <div className="mt-4">
              <h3 className="text-[14px] font-semibold text-[#0a0a0a]">Onboarding funnel</h3>
              <p className="text-[12px] text-[#6a7282]">How far landlord accounts get, from sign-up to a first work order.</p>
              <Funnel metrics={metrics} />
            </div>
          ) : null}
          {section.id === 'maintenance' ? (
            <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-[#0a0a0a]">Per week</h3>
                <WeeklyChart points={readArray<WeeklyPoint>(metrics, 'maintenance', 'weekly')} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-[#0a0a0a]">By trade</h3>
                <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                  {readArray<TradeRow>(metrics, 'maintenance', 'by_trade').slice(0, 8).map((row) => (
                    <li key={row.trade} className="flex justify-between gap-3">
                      <span className="text-[#364153]">{tradeLabel(row.trade)}</span>
                      <span className="tabular-nums text-[#0a0a0a]">{row.created}</span>
                    </li>
                  ))}
                  {readArray<TradeRow>(metrics, 'maintenance', 'by_trade').length === 0 ? (
                    <li className="text-[#6a7282]">No work orders in this window.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          ) : null}
          {section.id === 'data_health' ? (
            <div className="mt-4">
              <h3 className="text-[14px] font-semibold text-[#0a0a0a]">Scheduled jobs needing attention</h3>
              {readArray<CronRow>(metrics, 'data_health', 'crons_needing_attention').length === 0 ? (
                <p className="mt-1 text-[13px] text-[#6a7282]">All required scheduled jobs are running.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-[13px]">
                    <thead className="text-[12px] uppercase tracking-[0.04em] text-[#6a7282]">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Job</th>
                        <th className="py-1 pr-3 font-medium">Status</th>
                        <th className="py-1 pr-3 font-medium">Scheduled</th>
                        <th className="py-1 font-medium">Failed runs (24 h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readArray<CronRow>(metrics, 'data_health', 'crons_needing_attention').map((row) => (
                        <tr key={row.jobname} className="border-t border-[#f3f4f6]">
                          <td className="py-1.5 pr-3 font-mono text-[12px] text-[#0a0a0a]">{row.jobname}</td>
                          <td className="py-1.5 pr-3 text-[#364153]">{row.status}</td>
                          <td className="py-1.5 pr-3 text-[#364153]">
                            {row.scheduled === null ? 'Unknown' : row.scheduled ? 'Yes' : 'No'}
                          </td>
                          <td className="py-1.5 tabular-nums text-[#364153]">{row.failed_runs_24h ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}
