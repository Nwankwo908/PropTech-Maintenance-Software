import { describe, expect, it } from 'vitest'
import { propertyHealthFactorBreakdownLines } from './propertyHealth'

describe('propertyHealthFactorBreakdownLines', () => {
  it('lists the four Vitals dimensions with points and what to do next', () => {
    const lines = propertyHealthFactorBreakdownLines([
      {
        key: 'open_items',
        label: 'Open action items',
        score: 18,
        maxPoints: 25,
        weight: 0.25,
        isFallback: false,
        detail: '1 open action item. Close 1 open action item → +7 pts',
      },
      {
        key: 'occupancy',
        label: 'Occupancy',
        score: 25,
        maxPoints: 25,
        weight: 0.25,
        isFallback: false,
        detail: '4 of 4 units occupied (100%)',
      },
      {
        key: 'vendor_coverage',
        label: 'Vendor coverage',
        score: 18,
        maxPoints: 25,
        weight: 0.25,
        isFallback: false,
        detail: '7 of 8 trades covered · missing HVAC. Add HVAC vendor → +7 pts',
      },
    ])

    expect(lines).toEqual([
      {
        label: 'Open action items',
        value: '18 / 25',
        detail: '1 open action item. Close 1 open action item → +7 pts',
      },
      { label: 'Occupancy', value: '25 / 25', detail: '4 of 4 units occupied (100%)' },
      {
        label: 'Vendor coverage',
        value: '18 / 25',
        detail: '7 of 8 trades covered · missing HVAC. Add HVAC vendor → +7 pts',
      },
      { label: 'Documentation', value: 'Unknown', detail: 'Add units to score this part.' },
    ])
  })
})
