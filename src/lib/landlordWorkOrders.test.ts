import { describe, expect, it } from 'vitest'
import { homeCheckFollowUpCategory } from '@shared/maintenance/homeCheckRepairCategory'
import { isLandlordFacingMaintenanceRequest } from '@/lib/landlordWorkOrders'

describe('Work Orders list', () => {
  it('hides a Home Check observation', () => {
    expect(
      isLandlordFacingMaintenanceRequest({
        description:
          'Home Check: four photos of the water heater and furnace or boiler. Observation only; no repairs or paid work authorized.',
        observation_only: true,
        trigger_type: 'home_check',
        source: 'home_check',
        metadata: { observation_only: true, source: 'home_check' },
        vendor_work_status: 'unassigned',
        priority: 'Normal',
      }),
    ).toBe(false)
  })

  it('lists a Home Check finding that needs a repair under a real category', () => {
    const description =
      'Home Check follow-up. The check reported a leak: water under the water heater. Review this before any paid work.'
    expect(
      isLandlordFacingMaintenanceRequest({
        description,
        observation_only: false,
        trigger_type: 'home_check',
        issue_category: 'plumbing',
        vendor_work_status: 'cancelled',
        is_test: true,
        urgency: 'emergency',
        priority: 'Normal',
      }),
    ).toBe(true)
    expect(homeCheckFollowUpCategory(description)).toBe('plumbing')
    expect(homeCheckFollowUpCategory(description)).not.toBe('other')
  })
})
