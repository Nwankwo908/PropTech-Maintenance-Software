import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildVendorProfileAttention,
  type VendorAttentionTicket,
} from '@/lib/vendorProfileAttention'
import {
  computeVendorProfileVerificationChecklist,
  type VerificationRecord,
} from '@/lib/vendorVerificationChecklist'
import { buildVendorReadinessView } from '@/lib/vendorReadiness'
import { summarizeWorkOrderCardBlurb } from '@/lib/workOrderCardSummary'
import {
  buildVendorVerificationRequestSms,
  isVendorVerificationRequestItemId,
  vendorVerificationRequestTitle,
  type VendorVerificationRequestItemId,
} from '@shared/sms/vendorInsuranceRequestSms'

const dashboardSource = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../components/AdminVendorDetailDashboard.tsx',
  ),
  'utf8',
)

const REQUEST_ITEM_IDS: VendorVerificationRequestItemId[] = [
  'license',
  'coi_coverage',
  'w9',
  'stripe_connect',
  'trade_categories',
  'service_area',
]

function incompleteVerification(): VerificationRecord {
  return {
    status: 'needs_review',
    trade_categories: ['plumbing'],
    license_number: 'PL-99',
    license_expiration: '2020-01-01',
    coi_general_liability: 250_000,
    coi_expiration: '2020-06-01',
    w9_received: true,
  }
}

function openTicket(id: string): VendorAttentionTicket {
  return {
    id,
    vendorWorkStatus: 'in_progress',
    autoReassignLastOutcome: null,
    scheduledAt: '2026-11-07T15:00:00.000Z',
    stallFollowUpSentAt: null,
    stallFollowUpKind: null,
  }
}

describe('vendor profile page wiring', () => {
  it('keeps job history, compliance progress, and request modal paths wired', () => {
    expect(dashboardSource).toContain('Job history')
    expect(dashboardSource).toContain('Compliance & verification')
    expect(dashboardSource).toContain('bg-[#611879]')
    expect(dashboardSource).toContain('buildVendorReadinessView')
    expect(dashboardSource).toContain('readinessView.groups.map')
    expect(dashboardSource).toContain('{group.title}')
    expect(dashboardSource).toContain('openVerificationRequest')
    expect(dashboardSource).toContain('RequestVendorInsuranceModal')
    expect(dashboardSource).toContain('requestVendorVerificationUpdate')
    expect(dashboardSource).toContain('summarizeWorkOrderCardBlurb')
    expect(dashboardSource).toContain('VendorJobStatusChip')
    expect(dashboardSource).toContain('opensInsuranceRequest')
    expect(dashboardSource).toContain('onRequest={openVerificationRequest}')
    expect(dashboardSource).toContain('verificationProgress')
    expect(dashboardSource).toContain('formatResponse(job.durationMinutes)')
  })

  it('wires every requestable checklist item through shared SMS copy + titles', () => {
    for (const itemId of REQUEST_ITEM_IDS) {
      expect(isVendorVerificationRequestItemId(itemId)).toBe(true)
      expect(vendorVerificationRequestTitle(itemId).startsWith('Request')).toBe(true)
      const body = buildVendorVerificationRequestSms({
        itemId,
        vendorLabel: 'Chesapeake Pest',
        companyName: 'Maple Properties',
        renewalLink: 'https://www.ulohome.io/v/preview',
      })
      expect(body).toContain('Hi Chesapeake Pest,')
      expect(body).toContain('Maple Properties')
      expect(body).toContain('https://www.ulohome.io/v/preview')
    }
  })

  it('builds attention request CTAs for insurance and related compliance gaps', () => {
    const checklist = computeVendorProfileVerificationChecklist(incompleteVerification())
    const items = buildVendorProfileAttention({
      nowMs: Date.parse('2026-11-07T12:00:00.000Z'),
      checklist,
      verification: incompleteVerification(),
      tickets: [openTicket('ticket-1')],
    })
    const insurance = items.find((item) => item.id === 'compliance:coi_coverage')
    expect(insurance?.opensInsuranceRequest).toBe(true)
    expect(insurance?.requestItemId).toBe('coi_coverage')
    expect(insurance?.actionLabel).toBe('Request updated insurance')
  })
})

describe('vendor profile page performance', () => {
  it('keeps attention + checklist + job blurbs under budget', () => {
    const verification = incompleteVerification()
    const tickets = Array.from({ length: 40 }, (_, i) => openTicket(`ticket-${i}`))
    const descriptions = [
      'Kitchen sink is leaking under the cabinet',
      'Hi there, the bedroom outlet is sparking',
      'AC not cooling in the living room',
      'Who is coming to fix my repair?',
      'No hot water since this morning',
    ]
    const samples: number[] = []

    for (let i = 0; i < 80; i += 1) {
      const start = performance.now()
      const checklist = computeVendorProfileVerificationChecklist(verification)
      const attention = buildVendorProfileAttention({
        nowMs: Date.parse('2026-11-07T12:00:00.000Z'),
        checklist,
        verification,
        tickets,
      })
      const readiness = buildVendorReadinessView(checklist)
      const complete = readiness.completeCount
      const total = readiness.totalCount
      const pct = readiness.pct
      const blurbs = descriptions.map((description) =>
        summarizeWorkOrderCardBlurb(description, 'plumbing'),
      )
      const smsBodies = REQUEST_ITEM_IDS.map((itemId) =>
        buildVendorVerificationRequestSms({
          itemId,
          vendorLabel: 'Chesapeake Pest',
          companyName: 'Maple Properties',
          renewalLink: 'https://www.ulohome.io/v/preview',
        }),
      )
      samples.push(performance.now() - start)

      if (i === 0) {
        expect(attention.length).toBeGreaterThan(0)
        expect(pct).toBeGreaterThanOrEqual(0)
        expect(pct).toBeLessThanOrEqual(100)
        expect(blurbs.every((blurb) => blurb.split(/\s+/).length <= 8)).toBe(true)
        expect(smsBodies.every((body) => body.includes('Chesapeake Pest'))).toBe(true)
      }
    }

    const sorted = [...samples].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(0.5 * sorted.length)]!
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!
    expect(p50).toBeLessThan(15)
    expect(p95).toBeLessThan(40)
  })
})
