import { describe, expect, it } from 'vitest'
import {
  applyFutureMonthProjections,
  projectionsEnabledForMonthlySpend,
  type MonthlySpendChartRow,
} from './propertyAnalytics'

function month(
  label: string,
  monthIndex: number,
  proactive: number,
  reactive: number,
  isFuture: boolean,
): MonthlySpendChartRow {
  return { monthIndex, label, proactive, reactive, isFuture, isProjection: false }
}

describe('applyFutureMonthProjections', () => {
  it('keeps future months at zero when there is no spend history', () => {
    const actual = [
      month('Jan', 0, 0, 0, false),
      month('Feb', 1, 0, 0, false),
      month('Mar', 2, 0, 0, true),
    ]
    const result = applyFutureMonthProjections(actual)
    expect(result[2]).toMatchObject({ proactive: 0, reactive: 0, isProjection: false })
    expect(projectionsEnabledForMonthlySpend(actual)).toBe(false)
  })

  it('keeps future months at zero with only one month of spend', () => {
    const actual = [
      month('Jan', 0, 1200, 400, false),
      month('Feb', 1, 0, 0, false),
      month('Mar', 2, 0, 0, true),
    ]
    const result = applyFutureMonthProjections(actual)
    expect(result[2]).toMatchObject({ proactive: 0, reactive: 0, isProjection: false })
    expect(projectionsEnabledForMonthlySpend(actual)).toBe(false)
  })

  it('projects future months after two months with recognized spend', () => {
    const actual = [
      month('Jan', 0, 1000, 500, false),
      month('Feb', 1, 800, 200, false),
      month('Mar', 2, 0, 0, true),
    ]
    const result = applyFutureMonthProjections(actual)
    expect(result[2]).toMatchObject({
      proactive: 900,
      reactive: 350,
      isProjection: true,
    })
    expect(projectionsEnabledForMonthlySpend(actual)).toBe(true)
  })
})
