/**
 * Staff metrics catalog — the plain-English side of the metrics layer.
 *
 * Numbers are computed once in SQL (`public.get_staff_metrics`, migration
 * 20261114200000_staff_analytics_metrics.sql). This file names and describes
 * each number so the Ulo Ops dashboard and Ask Ulo's staff answers use the same
 * labels and definitions. Keep `path` in sync with the SQL JSON keys; the
 * catalog test fails if a path is missing from a sample payload.
 */

export type StaffMetricFormat = 'count' | 'rate' | 'usd' | 'hours' | 'minutes' | 'ms' | 'rating'

export type StaffMetricSectionId =
  | 'growth'
  | 'maintenance'
  | 'vendors'
  | 'money'
  | 'sms'
  | 'ai'
  | 'data_health'

export type StaffMetricDefinition = {
  /** Dotted path into the get_staff_metrics JSON, e.g. `maintenance.open_now`. */
  path: string
  label: string
  definition: string
  format: StaffMetricFormat
  /** Snapshot metrics describe "right now"; others cover the selected window. */
  snapshot?: boolean
  /** True when a higher value is bad (used to flag attention on the dashboard). */
  higherIsWorse?: boolean
  /** Extra words people use when asking about this metric. */
  keywords?: readonly string[]
}

export type StaffMetricSection = {
  id: StaffMetricSectionId
  title: string
  summary: string
  metrics: readonly StaffMetricDefinition[]
}

export const STAFF_METRIC_SECTIONS: readonly StaffMetricSection[] = [
  {
    id: 'growth',
    title: 'Growth and onboarding',
    summary: 'Accounts, homes and residents on Ulo, and how far landlords get through setup.',
    metrics: [
      { path: 'growth.landlords_total', label: 'Landlord accounts', definition: 'All landlord accounts, excluding demo accounts unless included.', format: 'count', snapshot: true, keywords: ['landlords', 'accounts', 'customers'] },
      { path: 'growth.landlords_new', label: 'New landlords', definition: 'Landlord accounts created in the window.', format: 'count', keywords: ['signups', 'new accounts', 'new customers'] },
      { path: 'growth.landlords_active', label: 'Active landlords', definition: 'Landlords with at least one work order or one inbound text in the window.', format: 'count', keywords: ['active', 'engaged', 'using'] },
      { path: 'growth.properties', label: 'Properties', definition: 'Homes added by landlords.', format: 'count', snapshot: true, keywords: ['homes', 'buildings'] },
      { path: 'growth.units', label: 'Units', definition: 'Apartments or units across all properties.', format: 'count', snapshot: true, keywords: ['apartments', 'doors'] },
      { path: 'growth.residents', label: 'Residents', definition: 'Current (not archived) residents.', format: 'count', snapshot: true, keywords: ['tenants', 'residents'] },
      { path: 'growth.residents_activated', label: 'Activated residents', definition: 'Residents who completed text-message activation.', format: 'count', snapshot: true, keywords: ['activated tenants'] },
      { path: 'growth.resident_activation_rate', label: 'Resident activation rate', definition: 'Activated residents divided by all current residents.', format: 'rate', snapshot: true, keywords: ['activation', 'tenant activation'] },
      { path: 'growth.waitlist_signups', label: 'Waitlist signups', definition: 'Waitlist signups in the window.', format: 'count', keywords: ['waitlist', 'leads'] },
      { path: 'growth.funnel.onboarding_completed', label: 'Finished setup', definition: 'Landlords whose onboarding status is completed.', format: 'count', snapshot: true, keywords: ['onboarding', 'setup', 'funnel'] },
      { path: 'growth.funnel.added_property', label: 'Added a property', definition: 'Landlords with at least one property.', format: 'count', snapshot: true, keywords: ['funnel'] },
      { path: 'growth.funnel.added_residents', label: 'Added residents', definition: 'Landlords with at least one resident.', format: 'count', snapshot: true, keywords: ['funnel'] },
      { path: 'growth.funnel.activated_a_resident', label: 'Activated a resident', definition: 'Landlords with at least one activated resident.', format: 'count', snapshot: true, keywords: ['funnel'] },
      { path: 'growth.funnel.first_work_order', label: 'Got a first work order', definition: 'Landlords with at least one work order ever.', format: 'count', snapshot: true, keywords: ['funnel', 'first request'] },
    ],
  },
  {
    id: 'maintenance',
    title: 'Maintenance operations',
    summary: 'Work orders across all landlords. Home Check observation rows are not counted.',
    metrics: [
      { path: 'maintenance.created', label: 'Work orders created', definition: 'Work orders created in the window.', format: 'count', keywords: ['work orders', 'requests', 'tickets', 'repairs', 'volume'] },
      { path: 'maintenance.completed', label: 'Completed', definition: 'Work orders marked completed in the window.', format: 'count', keywords: ['done', 'closed', 'finished'] },
      { path: 'maintenance.cancelled', label: 'Cancelled', definition: 'Work orders cancelled in the window.', format: 'count' },
      { path: 'maintenance.emergencies', label: 'Emergencies', definition: 'Work orders created in the window marked emergency or urgent.', format: 'count', keywords: ['urgent', 'emergency'] },
      { path: 'maintenance.open_now', label: 'Open now', definition: 'Work orders not completed, cancelled or archived.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['open', 'backlog', 'outstanding'] },
      { path: 'maintenance.overdue_now', label: 'Overdue now', definition: 'Open work orders past their due date.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['overdue', 'late', 'sla'] },
      { path: 'maintenance.stalled_now', label: 'Stalled now', definition: 'Open work orders where Ulo already sent a stall follow-up.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['stalled', 'stuck'] },
      { path: 'maintenance.needs_staff_now', label: 'Needs staff now', definition: 'Open work orders where automatic vendor reassignment gave up and needs a person.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['needs admin', 'attention', 'escalated'] },
      { path: 'maintenance.reopened', label: 'Reopened', definition: 'Completed or cancelled work orders reopened in the window.', format: 'count', higherIsWorse: true, keywords: ['reopen', 'rework'] },
      { path: 'maintenance.median_hours_to_assign', label: 'Median time to assign', definition: 'Typical hours from request to vendor assigned, for work orders created in the window.', format: 'hours', higherIsWorse: true, keywords: ['assign', 'dispatch', 'speed'] },
      { path: 'maintenance.p90_hours_to_assign', label: 'Slowest 10% time to assign', definition: '90th percentile hours from request to vendor assigned.', format: 'hours', higherIsWorse: true },
      { path: 'maintenance.median_hours_to_complete', label: 'Median time to complete', definition: 'Typical hours from request to completed, for jobs completed in the window.', format: 'hours', higherIsWorse: true, keywords: ['resolution', 'resolve', 'turnaround'] },
      { path: 'maintenance.p90_hours_to_complete', label: 'Slowest 10% time to complete', definition: '90th percentile hours from request to completed.', format: 'hours', higherIsWorse: true },
    ],
  },
  {
    id: 'vendors',
    title: 'Vendors',
    summary: 'How quickly vendors answer job offers and how landlords and residents rate them.',
    metrics: [
      { path: 'vendors.active_vendors', label: 'Vendors with jobs', definition: 'Distinct vendors assigned to work orders created in the window.', format: 'count', keywords: ['vendors', 'contractors'] },
      { path: 'vendors.offers', label: 'Job offers', definition: 'Job offers sent to vendors in the window (one per work order and vendor).', format: 'count' },
      { path: 'vendors.acceptance_rate', label: 'Acceptance rate', definition: 'Accepted offers divided by offers that got an answer.', format: 'rate', keywords: ['accept', 'decline'] },
      { path: 'vendors.declined', label: 'Declined offers', definition: 'Offers vendors declined in the window.', format: 'count', higherIsWorse: true },
      { path: 'vendors.no_response', label: 'Unanswered offers', definition: 'Offers with no accept or decline yet.', format: 'count', higherIsWorse: true },
      { path: 'vendors.median_minutes_to_respond', label: 'Median response time', definition: 'Typical minutes from offer to accept or decline.', format: 'minutes', higherIsWorse: true, keywords: ['response time', 'respond'] },
      { path: 'vendors.average_rating', label: 'Average rating', definition: 'Average vendor rating (1–5) submitted in the window.', format: 'rating', keywords: ['rating', 'reviews', 'quality'] },
      { path: 'vendors.ratings', label: 'Ratings submitted', definition: 'Vendor ratings submitted in the window.', format: 'count' },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    summary: 'Rent and maintenance dollars recorded in Ulo during the window.',
    metrics: [
      { path: 'money.rent_due', label: 'Rent due', definition: 'Rent charges recorded in the window.', format: 'usd', keywords: ['rent'] },
      { path: 'money.rent_collected_online', label: 'Rent collected online', definition: 'Rent paid through Stripe in the window.', format: 'usd', keywords: ['collected', 'payments', 'stripe'] },
      { path: 'money.rent_reported_by_tenants', label: 'Rent reported by tenants', definition: 'Rent tenants said they paid outside Ulo (not verified).', format: 'usd', keywords: ['reported'] },
      { path: 'money.rent_late_events', label: 'Late rent escalations', definition: 'Times rent was escalated as late in the window.', format: 'count', higherIsWorse: true, keywords: ['late rent', 'delinquent'] },
      { path: 'money.maintenance_spend', label: 'Maintenance spend', definition: 'Repair costs recognized in the window.', format: 'usd', keywords: ['spend', 'cost', 'repairs cost'] },
      { path: 'money.invoices_approved_total', label: 'Invoices approved', definition: 'Total of vendor invoices approved in the window.', format: 'usd', keywords: ['invoices'] },
      { path: 'money.invoices_waiting_count', label: 'Invoices waiting', definition: 'Vendor invoices submitted and not yet approved.', format: 'count', snapshot: true, higherIsWorse: true },
      { path: 'money.invoices_waiting_total', label: 'Invoice dollars waiting', definition: 'Total of vendor invoices waiting for approval.', format: 'usd', snapshot: true },
    ],
  },
  {
    id: 'sms',
    title: 'Tenant communication',
    summary: 'Text messages and resident activation.',
    metrics: [
      { path: 'sms.inbound', label: 'Texts received', definition: 'Inbound texts in the window.', format: 'count', keywords: ['sms', 'texts', 'messages'] },
      { path: 'sms.outbound', label: 'Texts sent', definition: 'Outbound texts in the window.', format: 'count' },
      { path: 'sms.outbound_failed', label: 'Failed texts', definition: 'Outbound texts the carrier marked failed or undelivered.', format: 'count', higherIsWorse: true, keywords: ['failed', 'undelivered', 'delivery'] },
      { path: 'sms.outbound_failure_rate', label: 'Text failure rate', definition: 'Failed outbound texts divided by all outbound texts.', format: 'rate', higherIsWorse: true },
      { path: 'sms.residents_activated_in_window', label: 'Residents activated', definition: 'Activated residents added in the window.', format: 'count' },
      { path: 'sms.residents_activation_failed', label: 'Activation texts failing', definition: 'Residents whose activation text could not be delivered.', format: 'count', snapshot: true, higherIsWorse: true },
      { path: 'sms.residents_opted_out', label: 'Residents opted out', definition: 'Residents who opted out of texts.', format: 'count', snapshot: true, keywords: ['opt out', 'stop'] },
    ],
  },
  {
    id: 'ai',
    title: 'AI quality and cost',
    summary: 'Maintenance classification and Ask Ulo answers.',
    metrics: [
      { path: 'ai.classifications', label: 'Requests classified', definition: 'Maintenance requests the classifier ran on in the window.', format: 'count', keywords: ['classification', 'triage'] },
      { path: 'ai.classification_rules_only_rate', label: 'Rules-only rate', definition: 'Share of classifications that used rules only because the AI was unavailable or skipped.', format: 'rate', higherIsWorse: true, keywords: ['fallback'] },
      { path: 'ai.classification_low_confidence', label: 'Low-confidence classifications', definition: 'Classifications with low confidence.', format: 'count', higherIsWorse: true },
      { path: 'ai.classification_review_accuracy', label: 'Reviewed accuracy', definition: 'Share of reviewed classifications marked correct.', format: 'rate', keywords: ['accuracy', 'correct'] },
      { path: 'ai.ask_ulo_answers', label: 'Ask Ulo answers', definition: 'Ask Ulo questions answered in the window.', format: 'count', keywords: ['ask ulo', 'assistant', 'chat'] },
      { path: 'ai.ask_ulo_refused', label: 'Ask Ulo refusals', definition: 'Ask Ulo questions refused by safety rules.', format: 'count' },
      { path: 'ai.ask_ulo_blocked_or_clarified', label: 'Blocked or clarified', definition: 'Ask Ulo turns that were refused or needed clarification.', format: 'count' },
      { path: 'ai.ask_ulo_cost_usd', label: 'Ask Ulo cost', definition: 'Estimated AI cost of Ask Ulo answers in the window.', format: 'usd', keywords: ['ai cost', 'tokens', 'spend'] },
      { path: 'ai.ask_ulo_tokens', label: 'Ask Ulo tokens', definition: 'Prompt, completion and embedding tokens used by Ask Ulo.', format: 'count' },
      { path: 'ai.ask_ulo_median_latency_ms', label: 'Ask Ulo median latency', definition: 'Typical time to produce an Ask Ulo answer.', format: 'ms', higherIsWorse: true, keywords: ['latency', 'slow', 'speed'] },
    ],
  },
  {
    id: 'data_health',
    title: 'Data health',
    summary: 'Signals that data or scheduled jobs need attention.',
    metrics: [
      { path: 'data_health.unit_mismatch_findings_7d', label: 'Unit mismatch findings (7 days)', definition: 'Work orders the daily audit found linked to a unit the resident does not live in.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['mismatch', 'wrong unit', 'audit', 'integrity'] },
      { path: 'data_health.work_orders_missing_property', label: 'Work orders without a property', definition: 'Work orders with no property linked.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['missing property', 'orphan'] },
      { path: 'data_health.required_crons_missing', label: 'Scheduled jobs missing', definition: 'Required jobs marked live but not scheduled.', format: 'count', snapshot: true, higherIsWorse: true, keywords: ['cron', 'scheduled jobs', 'jobs'] },
      { path: 'data_health.required_crons_paused', label: 'Scheduled jobs paused', definition: 'Required jobs intentionally paused.', format: 'count', snapshot: true },
      { path: 'data_health.required_cron_failed_runs_24h', label: 'Failed job runs (24 hours)', definition: 'Failed runs of required scheduled jobs in the last day.', format: 'count', snapshot: true, higherIsWorse: true },
      { path: 'data_health.delivery_retries_7d', label: 'Notification retries (7 days)', definition: 'Notification deliveries retried in the last week.', format: 'count', snapshot: true },
    ],
  },
]

export const STAFF_METRIC_DEFINITIONS: readonly StaffMetricDefinition[] =
  STAFF_METRIC_SECTIONS.flatMap((section) => section.metrics)

export const STAFF_METRICS_WINDOWS = [7, 30, 90] as const

/** Read a dotted path from the metrics JSON. Missing or non-numeric values are null. */
export function readStaffMetric(metrics: unknown, path: string): number | null {
  let current: unknown = metrics
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current === 'number' && Number.isFinite(current)) return current
  if (typeof current === 'string' && current.trim() !== '') {
    const parsed = Number(current)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function formatStaffMetric(value: number | null, format: StaffMetricFormat): string {
  if (value === null) return '—'
  switch (format) {
    case 'rate':
      return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`
    case 'usd':
      return value >= 1000
        ? `$${Math.round(value).toLocaleString('en-US')}`
        : `$${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
    case 'hours':
      return value < 1 ? `${Math.round(value * 60)} min` : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`
    case 'minutes':
      return value >= 120 ? `${(value / 60).toFixed(1)} h` : `${Math.round(value)} min`
    case 'ms':
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
    case 'rating':
      return `${value.toFixed(1)} / 5`
    default:
      return Math.round(value).toLocaleString('en-US')
  }
}

export type StaffMetricFact = {
  path: string
  section: string
  label: string
  value: string
  definition: string
  snapshot: boolean
}

/** Every catalog metric with its formatted value, for prompts and fallbacks. */
export function staffMetricFacts(metrics: unknown): StaffMetricFact[] {
  return STAFF_METRIC_SECTIONS.flatMap((section) =>
    section.metrics.map((metric) => ({
      path: metric.path,
      section: section.title,
      label: metric.label,
      value: formatStaffMetric(readStaffMetric(metrics, metric.path), metric.format),
      definition: metric.definition,
      snapshot: metric.snapshot === true,
    })),
  )
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2)
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'how', 'many', 'much', 'what', 'are', 'was', 'were', 'our', 'this', 'that',
  'with', 'last', 'days', 'week', 'month', 'have', 'has', 'did', 'does', 'from', 'all', 'any',
  'show', 'tell', 'give', 'about', 'there', 'right', 'now', 'today',
])

/**
 * Pick the catalog metrics most related to a question (keyword overlap with the
 * label, definition, keywords and section). Used to focus the AI prompt and as
 * the no-AI fallback answer.
 */
export function matchStaffMetrics(question: string, limit = 6): StaffMetricDefinition[] {
  const asked = words(question).filter((w) => !STOP_WORDS.has(w))
  if (asked.length === 0) return []
  const scored = STAFF_METRIC_SECTIONS.flatMap((section) =>
    section.metrics.map((metric) => {
      const haystack = new Set(
        words([metric.label, metric.definition, section.title, ...(metric.keywords ?? [])].join(' ')),
      )
      const labelWords = new Set(words([metric.label, ...(metric.keywords ?? [])].join(' ')))
      let score = 0
      for (const word of asked) {
        const stem = word.replace(/s$/, '')
        for (const candidate of haystack) {
          if (candidate === word || candidate.replace(/s$/, '') === stem) {
            score += labelWords.has(candidate) ? 3 : 1
            break
          }
        }
      }
      return { metric, score }
    }),
  )
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.metric)
}

/** Plain answer listing the matched metrics. Used when the AI is unavailable. */
export function fallbackStaffMetricsAnswer(question: string, metrics: unknown, windowDays: number): string {
  const matched = matchStaffMetrics(question)
  if (matched.length === 0) {
    return 'I could not match that question to a staff metric. Try asking about work orders, vendors, rent, texts, Ask Ulo or data health.'
  }
  const lines = matched.map((metric) => {
    const value = formatStaffMetric(readStaffMetric(metrics, metric.path), metric.format)
    const scope = metric.snapshot ? 'right now' : `last ${windowDays} days`
    return `- **${metric.label}** (${scope}): ${value}. ${metric.definition}`
  })
  return `Here are the closest metrics:\n\n${lines.join('\n')}`
}
