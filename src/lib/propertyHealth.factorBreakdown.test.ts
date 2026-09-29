import { describe, expect, it } from 'vitest'
import { propertyHealthFactorBreakdownLines } from './propertyHealth'

describe('propertyHealthFactorBreakdownLines', () => {
  it('matches the Factor / Status / What it means copy for unknown condition', () => {
    const lines = propertyHealthFactorBreakdownLines([
      {
        key: 'condition',
        label: 'Condition',
        score: 0,
        weight: 0.4,
        isFallback: true,
        detail: 'Not enough information yet',
      },
      {
        key: 'maintenance',
        label: 'Maintenance',
        score: 100,
        weight: 0.35,
        isFallback: false,
        detail: 'No deductions',
      },
      {
        key: 'risk',
        label: 'Risk',
        score: 100,
        weight: 0.25,
        isFallback: false,
        detail: 'No deductions',
      },
    ])

    expect(lines).toEqual([
      {
        label: 'Condition',
        value: 'Unknown',
        detail: 'Add property details to calculate this part.',
      },
      {
        label: 'Maintenance',
        value: '100',
        detail: 'No maintenance issues are currently lowering this score.',
      },
      {
        label: 'Risk',
        value: '100',
        detail: 'No recorded risks are currently lowering this score.',
      },
    ])
  })
})
