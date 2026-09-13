import { describe, expect, it } from 'vitest'
import { emptyAdminWorkflowDashboardData, type AdminRentCollectionRow } from '@/lib/adminWorkflows'
import { buildSmartIntelligence } from '@/lib/smartIntelligence/buildSmartIntelligence'
import { evaluateLeaseIntelligence } from '@/lib/smartIntelligence/evaluateLease'
import { evaluateMaintenanceIntelligence } from '@/lib/smartIntelligence/evaluateMaintenance'
import { evaluateRentIntelligence } from '@/lib/smartIntelligence/evaluateRent'
import type { SmartIntelligenceContext, SmartIntelligenceResident } from '@/lib/smartIntelligence/types'

const john: SmartIntelligenceResident = {
  id: 'res-1',
  name: 'John Smith',
  unitDisplay: 'Unit 2B',
  balanceDue: 0,
  monthlyRent: 1850,
  rentDueDay: 15,
  leaseStartDate: '2026-01-01',
  leaseEndDate: '2027-07-31',
}

function ctx(overrides: Partial<SmartIntelligenceContext> = {}): SmartIntelligenceContext {
  return {
    resident: john,
    now: new Date(2026, 8, 12),
    ...overrides,
  }
}

function rentRun(overrides: Partial<AdminRentCollectionRow>): AdminRentCollectionRow {
  return {
    id: 'rent-run-1',
    templateId: 'rent_collection',
    templateName: 'Rent collection',
    templateType: 'rent',
    status: 'active',
    currentStep: null,
    entityType: 'resident',
    entityId: 'res-1',
    residentId: 'res-1',
    residentName: 'John Smith',
    unitLabel: '2B',
    propertyLabel: 'Maple',
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    lastEventType: null,
    lastEventMessage: null,
    lastEventAt: null,
    escalationReason: null,
    issueCategory: null,
    vendorWorkStatus: null,
    assignedVendorId: null,
    amountDue: 1850,
    billingPeriod: '2026-09',
    rentDueDate: '2026-09-12',
    rentClassification: 'rent_due_today',
    isDueToday: true,
    isOverdue: false,
    reminderSent: true,
    reminderSmsSent: true,
    reminderEmailSent: false,
    paymentStatus: 'Due today — unpaid',
    paymentIntent: null,
    paymentPlanSmsSent: false,
    lateFeeWaiverSmsSent: false,
    timeline: [],
    ...overrides,
  }
}

function withRent(run: AdminRentCollectionRow): SmartIntelligenceContext['workflowData'] {
  const empty = emptyAdminWorkflowDashboardData()
  return {
    ...empty,
    rentCollection: {
      ...empty.rentCollection,
      runs: [run],
    },
  }
}

describe('buildSmartIntelligence', () => {
  it('returns nothing when the resident is current and quiet', () => {
    expect(
      buildSmartIntelligence(
        ctx({
          resident: { ...john, rentDueDay: 1, leaseEndDate: '2028-08-01' },
          now: new Date(2026, 8, 12),
        }),
      ),
    ).toEqual([])
  })

  it('surfaces rent due soon', () => {
    const insights = evaluateRentIntelligence(
      ctx({
        resident: { ...john, rentDueDay: 15 },
        now: new Date(2026, 8, 12),
      }),
    )
    expect(insights[0]?.title).toBe('Rent due soon')
    expect(insights[0]?.description).toContain('$1,850')
    expect(insights[0]?.action?.label).toBe('View Rent')
  })

  it('combines due rent and an existing balance into one confirmation', () => {
    const insights = buildSmartIntelligence(
      ctx({
        resident: { ...john, balanceDue: 425, rentDueDay: 12 },
        workflowData: withRent(rentRun({})),
        now: new Date(2026, 8, 12),
      }),
    )
    expect(insights.filter((item) => item.type === 'rent')).toHaveLength(1)
    expect(insights[0]?.title).toContain('needs payment confirmation')
    expect(insights[0]?.description).toMatch(/1,850/)
    expect(insights[0]?.description).toMatch(/425/)
    expect(insights[0]?.action?.label).toBe('Confirm Payment')
  })

  it('flags a lease that expires inside the notice window', () => {
    const insights = evaluateLeaseIntelligence(
      ctx({
        resident: { ...john, leaseEndDate: '2026-10-20' },
        now: new Date(2026, 8, 12),
      }),
    )
    expect(insights[0]?.title).toMatch(/Lease expires in 38 days/)
    expect(insights[0]?.description).toContain('October 20')
  })

  it('does not invent a lease item when the term is far away', () => {
    expect(
      evaluateLeaseIntelligence(
        ctx({
          resident: { ...john, leaseEndDate: '2028-01-01' },
          now: new Date(2026, 8, 12),
        }),
      ),
    ).toEqual([])
  })

  it('asks the landlord to find a vendor for unassigned work', () => {
    const insights = evaluateMaintenanceIntelligence(
      ctx({
        tickets: [
          {
            id: 'wo-1',
            description: 'Kitchen sink is leaking',
            issueCategory: 'plumbing',
            vendorWorkStatus: 'unassigned',
            assignedVendorId: null,
            assignedAt: null,
            urgency: null,
            severity: null,
            priority: null,
            scheduledAt: null,
            dueAt: null,
            createdAt: '2026-09-10T12:00:00.000Z',
          },
        ],
      }),
    )
    expect(insights[0]?.title).toBe('Maintenance request awaiting vendor')
    expect(insights[0]?.action?.label).toBe('Find Vendor')
  })

  it('ranks overdue maintenance ahead of upcoming rent', () => {
    const insights = buildSmartIntelligence(
      ctx({
        resident: { ...john, rentDueDay: 15, balanceDue: 0 },
        now: new Date(2026, 8, 12),
        tickets: [
          {
            id: 'wo-overdue',
            description: 'HVAC not cooling',
            issueCategory: 'hvac',
            vendorWorkStatus: 'in_progress',
            assignedVendorId: 'vendor-1',
            assignedAt: '2026-09-01T12:00:00.000Z',
            urgency: 'emergency',
            severity: null,
            priority: null,
            scheduledAt: null,
            dueAt: '2026-09-08',
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ],
      }),
    )
    expect(insights[0]?.priority).toBe('urgent')
    expect(insights[0]?.type).toBe('maintenance')
  })

  it('skips status-question tickets', () => {
    expect(
      evaluateMaintenanceIntelligence(
        ctx({
          tickets: [
            {
              id: 'wo-q',
              description: 'Who is coming to fix my electrical issue?',
              issueCategory: 'electrical',
              vendorWorkStatus: 'unassigned',
              assignedVendorId: null,
              assignedAt: null,
              urgency: null,
              severity: null,
              priority: null,
              scheduledAt: null,
              dueAt: null,
              createdAt: '2026-09-10T12:00:00.000Z',
            },
          ],
        }),
      ),
    ).toEqual([])
  })

  it('caps the card at five insights', () => {
    const tickets = Array.from({ length: 8 }, (_, index) => ({
      id: `wo-${index}`,
      description: `Issue ${index}`,
      issueCategory: 'plumbing',
      vendorWorkStatus: 'unassigned' as const,
      assignedVendorId: null,
      assignedAt: null,
      urgency: 'emergency',
      severity: null,
      priority: null,
      scheduledAt: null,
      dueAt: '2026-09-01',
      createdAt: '2026-09-01T12:00:00.000Z',
    }))
    const insights = buildSmartIntelligence(ctx({ tickets }))
    expect(insights.length).toBeLessThanOrEqual(5)
  })
})
