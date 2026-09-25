import { describe, expect, it, vi } from 'vitest'
import {
  emptyFactoryResetActivityFeed,
  factoryResetSuccessLogPayload,
  formatFactoryResetFailureAlert,
  isFactoryResetActivityFeedEmpty,
  reportFactoryResetFailureToUser,
  reportFactoryResetSuccessToConsole,
  type FactoryResetResult,
} from '@/lib/onboarding/factoryResetOutcome'

describe('isFactoryResetActivityFeedEmpty', () => {
  it('requires both counts to be zero with no count error', () => {
    expect(
      isFactoryResetActivityFeedEmpty({
        remainingOperationsGraph: 0,
        remainingPropertyOperationsGraph: 0,
      }),
    ).toBe(true)
    expect(
      isFactoryResetActivityFeedEmpty({
        remainingOperationsGraph: 1,
        remainingPropertyOperationsGraph: 0,
      }),
    ).toBe(false)
    expect(
      isFactoryResetActivityFeedEmpty({
        remainingOperationsGraph: 0,
        remainingPropertyOperationsGraph: 0,
        countError: 'operations_graph_events: RLS',
      }),
    ).toBe(false)
  })
})

describe('formatFactoryResetFailureAlert', () => {
  it('includes table names, counts, and opsPurgePath in the alert string', () => {
    const result: Pick<FactoryResetResult, 'error' | 'opsPurgePath' | 'activityFeed'> = {
      error: 'Activity feed still has rows after reset.',
      opsPurgePath: 'client_fallback',
      activityFeed: {
        remainingOperationsGraph: 12,
        remainingPropertyOperationsGraph: 3,
      },
    }
    const alert = formatFactoryResetFailureAlert(result)
    expect(alert).toContain('Activity feed still has rows after reset.')
    expect(alert).toContain('operations_graph_events: 12 remaining')
    expect(alert).toContain('property_operations_graph: 3 remaining')
    expect(alert).toContain('Ops purge path: client_fallback.')
    expect(alert).toContain('Returning to the setup choice screen.')
  })

  it('reflects count-query failure without omitting opsPurgePath', () => {
    const alert = formatFactoryResetFailureAlert({
      error: 'Activity feed count could not be verified after reset.',
      opsPurgePath: 'purge_landlord_portfolio',
      activityFeed: {
        ...emptyFactoryResetActivityFeed('operations_graph_events: permission denied'),
      },
    })
    expect(alert).toMatch(/count could not be verified/i)
    expect(alert).toContain('permission denied')
    expect(alert).toContain('Ops purge path: purge_landlord_portfolio.')
    expect(alert).toContain('operations_graph_events:')
    expect(alert).toContain('property_operations_graph:')
  })
})

describe('reportFactoryResetFailureToUser', () => {
  it('console.errors the full structured result before alerting with forensic text', () => {
    const result: FactoryResetResult = {
      ok: false,
      error: 'Activity feed still has rows after reset.',
      opsPurgePath: 'client_fallback',
      activityFeed: {
        remainingOperationsGraph: 12,
        remainingPropertyOperationsGraph: 3,
      },
    }
    const calls: Array<{ kind: 'error' | 'alert'; args: unknown[] }> = []
    const message = reportFactoryResetFailureToUser(result, {
      error: (...args) => calls.push({ kind: 'error', args }),
      alert: (text) => calls.push({ kind: 'alert', args: [text] }),
    })

    expect(calls.map((c) => c.kind)).toEqual(['error', 'alert'])
    expect(calls[0]?.args[1]).toEqual(result)
    expect(message).toContain('operations_graph_events: 12 remaining')
    expect(message).toContain('property_operations_graph: 3 remaining')
    expect(message).toContain('Ops purge path: client_fallback.')
    expect(calls[1]?.args[0]).toBe(message)
  })

  it('surfaces count-query failure in the alert text with opsPurgePath', () => {
    const result: FactoryResetResult = {
      ok: false,
      error: 'Activity feed count could not be verified after reset.',
      opsPurgePath: 'purge_landlord_portfolio',
      activityFeed: emptyFactoryResetActivityFeed('operations_graph_events: timeout'),
    }
    let alertText = ''
    reportFactoryResetFailureToUser(result, {
      error: () => {},
      alert: (text) => {
        alertText = text
      },
    })
    expect(alertText).toMatch(/count could not be verified/i)
    expect(alertText).toContain('Ops purge path: purge_landlord_portfolio.')
  })
})

describe('reportFactoryResetSuccessToConsole', () => {
  it('logs structured success without alerting', () => {
    const result: FactoryResetResult = {
      ok: true,
      opsPurgePath: 'purge_landlord_portfolio',
      activityFeed: {
        remainingOperationsGraph: 0,
        remainingPropertyOperationsGraph: 0,
      },
    }
    const log = vi.fn()
    reportFactoryResetSuccessToConsole(result, { log })
    expect(log).toHaveBeenCalledWith(
      '[AdminLayout] factory reset ok',
      factoryResetSuccessLogPayload(result),
    )
  })
})
