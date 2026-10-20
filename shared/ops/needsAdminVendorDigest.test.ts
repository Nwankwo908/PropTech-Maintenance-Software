/**
 * Smoke-check that the redesigned digest subject shape stays stable.
 */
import { describe, expect, it } from 'vitest'
import { buildAdminVendorDigest } from '../../supabase/functions/_shared/adminVendorDigest.ts'

describe('needsAdminVendorDigest', () => {
  it('buildAdminVendorDigest subject summarizes count and age', () => {
    const now = new Date('2026-10-19T17:00:00.000Z')
    const digest = buildAdminVendorDigest(
      [
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          displayId: 'WO-AAAA',
          landlordName: 'KendoProperties',
          description: 'Bathroom sink is leaking bad under the vanity.',
          createdAt: new Date(now.getTime() - 48 * 3600_000).toISOString(),
          residentName: 'Ganaia Swinton',
        },
      ],
      {
        now,
        thresholdHours: 24,
        ticketUrl: (id) => `https://www.ulohome.io/admin/requests?q=${id}`,
      },
    )
    expect(digest?.subject).toContain('1 ticket waiting on a vendor')
    expect(digest?.subject).toContain('oldest')
  })
})
