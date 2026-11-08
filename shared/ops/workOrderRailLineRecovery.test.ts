import { describe, expect, it } from 'vitest'
import { needsWorkOrderRailLineRecovery } from './workOrderRailLineRecovery.ts'

describe('needsWorkOrderRailLineRecovery', () => {
  it('flags awkward never-accepted and stiff confirmation drafts', () => {
    expect(
      needsWorkOrderRailLineRecovery(
        'Handyman Services By Michael never accepted. Vendor unresponsive — needs a new vendor choice.',
      ),
    ).toBe(true)
    expect(
      needsWorkOrderRailLineRecovery(
        'No acceptance from Handyman Services By Michael. Vendor unresponsive — needs a new vendor choice.',
      ),
    ).toBe(true)
    expect(
      needsWorkOrderRailLineRecovery('Ecosafe proposed Wed 2–4pm. Waiting on confirmation.'),
    ).toBe(true)
  })

  it('leaves already-friendly schedule copy alone', () => {
    expect(
      needsWorkOrderRailLineRecovery(
        'Waiting on Alex to confirm Flex Plumbing for Mon 2–4pm (asked 2h ago).',
      ),
    ).toBe(false)
    expect(
      needsWorkOrderRailLineRecovery(
        'Flex Plumbing is scheduled for Mon, Nov 9, 10:00 AM.',
      ),
    ).toBe(false)
  })
})
