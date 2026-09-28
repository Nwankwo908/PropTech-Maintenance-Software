/**
 * Pure helpers for needs-admin digest copy (unit-tested).
 */
import { describe, expect, it } from 'vitest'

// Mirror buildNeedsAdminVendorDigestEmail line shape without Deno imports.
function digestSubject(count: number, dayKey: string): string {
  return `Ulo: ${count} ticket${count === 1 ? '' : 's'} waiting for a vendor (${dayKey})`
}

describe('needsAdminVendorDigest', () => {
  it('subject pluralizes', () => {
    expect(digestSubject(1, '2026-09-28')).toContain('1 ticket waiting')
    expect(digestSubject(3, '2026-09-28')).toContain('3 tickets waiting')
  })
})
