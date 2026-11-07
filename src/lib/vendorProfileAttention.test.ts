import { describe, expect, it } from 'vitest'
import {
  attentionTitle,
  buildVendorProfileAttention,
  daysUntilIsoDate,
  isAttentionReopenPreviousStatus,
  isOpenVendorWorkStatus,
} from '@/lib/vendorProfileAttention'
import type { VerificationChecklist, VerificationRecord } from '@/lib/vendorVerificationChecklist'

const NOW = Date.parse('2026-11-07T12:00:00.000Z')

function checklistWith(
  items: VerificationChecklist['items'],
): VerificationChecklist {
  return {
    items,
    overall: 'needs_review',
    completeCount: 0,
    requiredCount: items.filter((item) => item.required).length,
    missingReasons: items.map((item) => item.detail),
  }
}

describe('vendorProfileAttention helpers', () => {
  it('treats completed/cancelled/declined as closed', () => {
    expect(isOpenVendorWorkStatus('accepted')).toBe(true)
    expect(isOpenVendorWorkStatus('completed')).toBe(false)
    expect(isOpenVendorWorkStatus('cancelled')).toBe(false)
    expect(isOpenVendorWorkStatus('declined')).toBe(false)
  })

  it('only surfaces completed→open reopens in attention', () => {
    expect(isAttentionReopenPreviousStatus('completed')).toBe(true)
    expect(isAttentionReopenPreviousStatus('cancelled')).toBe(false)
    expect(isAttentionReopenPreviousStatus('COMPLETED')).toBe(true)
  })

  it('computes days until ISO dates', () => {
    expect(daysUntilIsoDate('2026-11-07', NOW)).toBe(0)
    expect(daysUntilIsoDate('2026-12-07', NOW)).toBe(30)
    expect(daysUntilIsoDate('2026-10-07', NOW)).toBe(-31)
  })

  it('routes every attention kind through friendlier titles', () => {
    expect(attentionTitle({ kind: 'compliance', checklistId: 'coi_coverage' })).toBe(
      'I recommend requesting general liability insurance',
    )
    expect(attentionTitle({ kind: 'compliance', checklistId: 'w9' })).toBe(
      'I recommend finishing the W-9 details',
    )
    expect(attentionTitle({ kind: 'compliance', checklistId: 'license' })).toBe(
      'I recommend requesting an updated state license',
    )
    expect(
      attentionTitle({ kind: 'compliance_soon', which: 'license', when: 'Nov 20' }),
    ).toBe('I recommend renewing the license before Nov 20')
    expect(
      attentionTitle({
        kind: 'estimate',
        workOrderRef: 'WO-AAAA',
        amountLabel: '$240',
      }),
    ).toBe('I recommend approving the $240 estimate for WO-AAAA')
    expect(
      attentionTitle({
        kind: 'exhausted',
        workOrderRef: 'WO-AAAA',
        pendingAccept: true,
      }),
    ).toContain('I recommend reassigning')
    expect(attentionTitle({ kind: 'no_show', workOrderRef: 'WO-AAAA' })).toContain(
      'I recommend following up',
    )
    expect(attentionTitle({ kind: 'reopen', workOrderRef: 'WO-AAAA' })).toContain(
      'I recommend following up',
    )
  })
})

describe('buildVendorProfileAttention', () => {
  const openTicket = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    vendorWorkStatus: 'accepted',
    autoReassignLastOutcome: null as string | null,
  }

  it('marks compliance HIGH when the vendor has active jobs', () => {
    const items = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [openTicket],
      checklist: checklistWith([
        {
          id: 'w9',
          label: 'W-9',
          status: 'action_needed',
          required: true,
          detail: 'W-9 is incomplete',
        },
      ]),
    })
    expect(items[0]?.kind).toBe('compliance_high')
    expect(items[0]?.badgeLabel).toBe('HIGH')
    expect(items[0]?.sortRank).toBe(10)
    expect(items[0]?.title).toBe('I recommend finishing the W-9 details')
  })

  it('uses friendlier copy for general liability in attention', () => {
    const items = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [],
      checklist: checklistWith([
        {
          id: 'coi_coverage',
          label: 'General Liability (recommended $500K)',
          status: 'action_needed',
          required: false,
          detail: 'Insurance is expired',
        },
      ]),
    })
    expect(items[0]?.title).toBe('I recommend requesting general liability insurance')
  })

  it('includes license/insurance coming due within 30 days', () => {
    const verification: VerificationRecord = {
      status: 'verified',
      license_expiration: '2026-11-20',
      coi_expiration: '2026-12-01',
    }
    const items = buildVendorProfileAttention({
      nowMs: NOW,
      verification,
      tickets: [],
    })
    expect(items.map((item) => item.id).sort()).toEqual([
      'compliance_soon:coi',
      'compliance_soon:license',
    ])
    expect(items.every((item) => item.kind === 'compliance_soon')).toBe(true)
    expect(items.every((item) => item.title.startsWith('I recommend'))).toBe(true)
  })

  it('includes pending estimate approval on open tickets', () => {
    const items = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [openTicket],
      estimates: [
        {
          id: 'est-1',
          maintenanceRequestId: openTicket.id,
          status: 'pending_approval',
          totalAmount: 240,
        },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('estimate')
    expect(items[0]?.title).toMatch(/^I recommend approving/)
    expect(items[0]?.title).toContain('$240')
  })

  it('includes sticky needs_admin_vendor exhaustion and skips soft mid-follow-up', () => {
    const sticky = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [
        {
          ...openTicket,
          vendorWorkStatus: 'pending_accept',
          autoReassignLastOutcome: 'needs_admin_vendor|stall_follow_up',
          stallFollowUpSentAt: '2026-11-06T12:00:00.000Z',
        },
      ],
    })
    expect(sticky).toHaveLength(1)
    expect(sticky[0]?.kind).toBe('exhausted')
    expect(sticky[0]?.title).toMatch(/^I recommend/)

    const mid = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [
        {
          ...openTicket,
          vendorWorkStatus: 'pending_accept',
          autoReassignLastOutcome: null,
          stallFollowUpSentAt: '2026-11-06T12:00:00.000Z',
          stallFollowUpKind: 'pending_accept_stale',
        },
      ],
    })
    expect(mid).toEqual([])
  })

  it('includes no-shows on still-open tickets within 30 days', () => {
    const items = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [openTicket],
      noShows: [
        {
          id: 'ns-1',
          maintenanceRequestId: openTicket.id,
          recordedAt: '2026-11-01T12:00:00.000Z',
        },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('no_show')
    expect(items[0]?.title).toMatch(/^I recommend following up/)
  })

  it('shows completed→open reopens only while the job is still open', () => {
    const reopen = {
      id: 're-1',
      maintenanceRequestId: openTicket.id,
      reopenedAt: '2026-11-05T12:00:00.000Z',
      previousStatus: 'completed',
      newStatus: 'accepted',
    }
    const open = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [openTicket],
      reopens: [reopen],
    })
    expect(open).toHaveLength(1)
    expect(open[0]?.kind).toBe('reopen')
    expect(open[0]?.title).toMatch(/^I recommend following up/)

    const cancelledReopen = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [openTicket],
      reopens: [{ ...reopen, previousStatus: 'cancelled' }],
    })
    expect(cancelledReopen).toEqual([])

    const completedAgain = buildVendorProfileAttention({
      nowMs: NOW,
      tickets: [{ ...openTicket, vendorWorkStatus: 'completed' }],
      reopens: [reopen],
    })
    expect(completedAgain).toEqual([])
  })

  it('excludes normal progressing jobs with no attention signals', () => {
    expect(
      buildVendorProfileAttention({
        nowMs: NOW,
        tickets: [
          {
            id: openTicket.id,
            vendorWorkStatus: 'in_progress',
            autoReassignLastOutcome: null,
          },
        ],
        verification: { status: 'verified' },
      }),
    ).toEqual([])
  })
})
