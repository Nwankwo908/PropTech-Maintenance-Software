import { describe, expect, it } from 'vitest'
import {
  STAFF_METRIC_DEFINITIONS,
  STAFF_METRIC_SECTIONS,
  fallbackStaffMetricsAnswer,
  formatStaffMetric,
  matchStaffMetrics,
  readStaffMetric,
  staffMetricFacts,
} from './catalog'
import { STAFF_METRICS_SHAPE_FIXTURE } from './staffMetrics.fixture'

function hasPath(value: unknown, path: string): boolean {
  let current: unknown = value
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(key in (current as object))) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

describe('staff metrics catalog', () => {
  it('only names metrics that get_staff_metrics actually returns', () => {
    const missing = STAFF_METRIC_DEFINITIONS.filter(
      (metric) => !hasPath(STAFF_METRICS_SHAPE_FIXTURE, metric.path),
    ).map((metric) => metric.path)
    expect(missing).toEqual([])
  })

  it('uses unique paths and section ids that match the JSON sections', () => {
    const paths = STAFF_METRIC_DEFINITIONS.map((metric) => metric.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const section of STAFF_METRIC_SECTIONS) {
      expect(hasPath(STAFF_METRICS_SHAPE_FIXTURE, section.id)).toBe(true)
      for (const metric of section.metrics) {
        expect(metric.path.startsWith(`${section.id}.`)).toBe(true)
        expect(metric.definition.trim().length).toBeGreaterThan(10)
      }
    }
  })

  it('reads numbers, numeric strings and missing values', () => {
    const metrics = { maintenance: { open_now: 4, median_hours_to_assign: '2.5', p90: null } }
    expect(readStaffMetric(metrics, 'maintenance.open_now')).toBe(4)
    expect(readStaffMetric(metrics, 'maintenance.median_hours_to_assign')).toBe(2.5)
    expect(readStaffMetric(metrics, 'maintenance.p90')).toBeNull()
    expect(readStaffMetric(metrics, 'vendors.offers')).toBeNull()
    expect(readStaffMetric(null, 'a.b')).toBeNull()
  })

  it('formats each kind of metric', () => {
    expect(formatStaffMetric(null, 'count')).toBe('—')
    expect(formatStaffMetric(1234, 'count')).toBe('1,234')
    expect(formatStaffMetric(0.6667, 'rate')).toBe('67%')
    expect(formatStaffMetric(0.025, 'rate')).toBe('2.5%')
    expect(formatStaffMetric(0.03, 'usd')).toBe('$0.03')
    expect(formatStaffMetric(250, 'usd')).toBe('$250')
    expect(formatStaffMetric(12500.4, 'usd')).toBe('$12,500')
    expect(formatStaffMetric(0.5, 'hours')).toBe('30 min')
    expect(formatStaffMetric(24, 'hours')).toBe('24 h')
    expect(formatStaffMetric(30, 'minutes')).toBe('30 min')
    expect(formatStaffMetric(180, 'minutes')).toBe('3.0 h')
    expect(formatStaffMetric(1200, 'ms')).toBe('1.2 s')
    expect(formatStaffMetric(4.5, 'rating')).toBe('4.5 / 5')
  })

  it('matches common staff questions to the right metrics', () => {
    expect(matchStaffMetrics('How many work orders are overdue?').map((m) => m.path)).toContain(
      'maintenance.overdue_now',
    )
    expect(matchStaffMetrics('What is vendor acceptance rate?')[0]?.path).toBe('vendors.acceptance_rate')
    expect(matchStaffMetrics('How much rent was collected online?').map((m) => m.path)).toContain(
      'money.rent_collected_online',
    )
    expect(matchStaffMetrics('Any failed texts?').map((m) => m.path)).toContain('sms.outbound_failed')
    expect(matchStaffMetrics('what').length).toBe(0)
  })

  it('builds a fallback answer with values and definitions', () => {
    const metrics = { maintenance: { overdue_now: 3, open_now: 9 } }
    const answer = fallbackStaffMetricsAnswer('How many overdue work orders?', metrics, 30)
    expect(answer).toContain('**Overdue now** (right now): 3.')
    expect(fallbackStaffMetricsAnswer('hello', metrics, 30)).toMatch(/could not match/)
  })

  it('lists every metric as a fact with a formatted value', () => {
    const facts = staffMetricFacts(STAFF_METRICS_SHAPE_FIXTURE)
    expect(facts.length).toBe(STAFF_METRIC_DEFINITIONS.length)
    expect(facts.every((fact) => fact.value.length > 0)).toBe(true)
  })
})
