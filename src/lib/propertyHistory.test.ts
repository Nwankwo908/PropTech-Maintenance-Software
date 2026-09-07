import { describe, expect, it } from 'vitest'
import {
  assemblePropertyHistory,
  formatPropertyHistoryDate,
  PROPERTY_HISTORY_SOURCE_TABLES,
  type AssemblePropertyHistoryInput,
} from '@/lib/propertyHistory'

const base: AssemblePropertyHistoryInput = {
  propertyId: 'prop-1',
  building: '123 Main St',
  units: [
    {
      id: 'unit-2b',
      unitLabel: '2B',
      building: '123 Main St',
      status: 'active',
      propertyId: 'prop-1',
    },
    {
      id: 'unit-1a',
      unitLabel: '1A',
      building: 'Other Building',
      status: 'vacant',
      propertyId: 'prop-other',
    },
  ],
  residents: [{ id: 'res-1', fullName: 'Sarah Jenkins', unit: '2B', building: '123 Main St' }],
  tickets: [],
  invoices: [],
  vendors: [{ id: 'vend-1', name: 'ABC HVAC' }],
  rentRuns: [],
  graphEvents: [],
}

describe('formatPropertyHistoryDate', () => {
  it('uses zero-padded MM/DD/YY', () => {
    expect(formatPropertyHistoryDate(new Date(2026, 8, 5).getTime())).toBe('09/05/26')
    expect(formatPropertyHistoryDate(0)).toBe('—')
  })
})

describe('PROPERTY_HISTORY_SOURCE_TABLES', () => {
  it('does not read conversation-thread tables', () => {
    expect(PROPERTY_HISTORY_SOURCE_TABLES).not.toContain('sms_conversations')
    expect(PROPERTY_HISTORY_SOURCE_TABLES).not.toContain('sms_messages')
  })
})

describe('assemblePropertyHistory', () => {
  it('scopes maintenance to units on this property and orders newest first', () => {
    const rows = assemblePropertyHistory({
      ...base,
      tickets: [
        {
          id: 't-old',
          createdAt: '2026-08-01T12:00:00.000Z',
          assignedAt: null,
          completedAt: null,
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'plumbing',
          description: 'Sink leak',
          vendorWorkStatus: 'unassigned',
          assignedVendorId: null,
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: null,
        },
        {
          id: 't-new',
          createdAt: '2026-08-28T12:00:00.000Z',
          assignedAt: '2026-08-28T13:00:00.000Z',
          completedAt: '2026-08-28T18:00:00.000Z',
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'hvac',
          description: 'Capacitor replaced',
          vendorWorkStatus: 'completed',
          assignedVendorId: 'vend-1',
          photoPaths: [],
          completionPhotoPaths: ['jobs/cap.jpg'],
          spendStatus: 'pending_approval',
        },
        {
          id: 't-other',
          createdAt: '2026-08-29T12:00:00.000Z',
          assignedAt: null,
          completedAt: null,
          unit: '1A',
          unitId: 'unit-1a',
          building: 'Other Building',
          issueCategory: 'electrical',
          description: 'Outlet',
          vendorWorkStatus: 'unassigned',
          assignedVendorId: null,
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: null,
        },
      ],
      invoices: [
        {
          id: 'inv-1',
          maintenanceRequestId: 't-new',
          vendorId: 'vend-1',
          invoiceNumber: 'INV-2023-09',
          totalCost: 285,
          status: 'submitted',
          submittedAt: '2026-08-28T19:00:00.000Z',
          approvedAt: null,
        },
      ],
    })

    expect(rows.some((row) => row.maintenanceRequestId === 't-other')).toBe(false)
    expect(rows.some((row) => row.maintenanceRequestId === 't-old')).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.maintenanceRequestId).toBe('t-new')
    expect(rows[0]?.event).toContain('Capacitor replaced')
    expect(rows[0]?.event).toMatch(/WO-/)
    expect(rows[0]?.vendorInvoice).toBe('INV-2023-09')
    expect(rows[0]?.amount).toBe(285)
    expect(rows[0]?.activityId).toBe('maintenance:t-new')
    expect(rows[0]?.unitLabel).toBe('2B')
    expect(rows[0]?.residentName).toBe('Sarah Jenkins')
    expect(rows[0]?.contactType).toBe('vendor')
    expect(rows[0]?.contactName).toBe('ABC HVAC')
    expect(rows[0]?.paymentStatus).toBe('not_paid')
    expect(rows[0]?.paymentStatusLabel).toBe('NOT PAID')
    expect(rows[0]?.dateLabel).toBe('—')
  })

  it('marks completed maintenance paid when the invoice is approved', () => {
    const rows = assemblePropertyHistory({
      ...base,
      tickets: [
        {
          id: 't-paid',
          createdAt: '2026-08-28T12:00:00.000Z',
          assignedAt: '2026-08-28T13:00:00.000Z',
          completedAt: '2026-08-28T18:00:00.000Z',
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'hvac',
          description: 'Capacitor replaced',
          vendorWorkStatus: 'completed',
          assignedVendorId: 'vend-1',
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: 'recognized',
        },
      ],
      invoices: [
        {
          id: 'inv-paid',
          maintenanceRequestId: 't-paid',
          vendorId: 'vend-1',
          invoiceNumber: 'INV-88',
          totalCost: 285,
          status: 'approved',
          submittedAt: '2026-08-28T19:00:00.000Z',
          approvedAt: '2026-08-29T10:00:00.000Z',
        },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.paymentStatus).toBe('paid')
    expect(rows[0]?.paymentStatusLabel).toBe('PAID')
    expect(rows[0]?.dateLabel).not.toBe('—')
  })

  it('records completed rent with payment status and due amount', () => {
    const rows = assemblePropertyHistory({
      ...base,
      rentRuns: [
        {
          id: 'rent-open',
          propertyId: 'prop-1',
          unitId: 'unit-2b',
          residentId: 'res-1',
          status: 'active',
          startedAt: '2026-09-01T12:00:00.000Z',
          completedAt: null,
          metadata: {
            billing_period: '2026-09',
            rent_due_date: '2026-09-01',
            original_amount_due: 2400,
            amount_due: 2400,
            rent_status: 'unpaid',
          },
        },
        {
          id: 'rent-1',
          propertyId: 'prop-1',
          unitId: 'unit-2b',
          residentId: 'res-1',
          status: 'completed',
          startedAt: '2026-09-01T12:00:00.000Z',
          completedAt: '2026-09-01T18:00:00.000Z',
          metadata: {
            billing_period: '2026-09',
            rent_due_date: '2026-09-01',
            original_amount_due: 1850,
            amount_due: 0,
            paid_amount: 1850,
            rent_status: 'paid',
            payment_method: 'Zelle',
            paid_date: '2026-09-01',
          },
        },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.workflowRunId).toBe('rent-1')
    expect(rows[0]?.event).toBe('Rent · Paid')
    expect(rows[0]?.amount).toBe(1850)
    expect(rows[0]?.status).toBe('paid')
    expect(rows[0]?.paymentStatus).toBe('paid')
    expect(rows[0]?.paymentStatusLabel).toBe('PAID')
    expect(rows[0]?.contactType).toBe('tenant')
    expect(rows[0]?.contactName).toBe('Sarah Jenkins')
    expect(rows[0]?.vendorInvoice).toBe('Receipt · Zelle')
    expect(rows[0]?.dateLabel).toBe('09/01/26')
  })

  it('labels maintenance without an invoice as Pending and unlabeled invoices as Invoice', () => {
    const pending = assemblePropertyHistory({
      ...base,
      tickets: [
        {
          id: 't-pending',
          createdAt: '2026-08-28T12:00:00.000Z',
          assignedAt: '2026-08-28T13:00:00.000Z',
          completedAt: '2026-08-28T18:00:00.000Z',
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'hvac',
          description: 'Capacitor replaced',
          vendorWorkStatus: 'completed',
          assignedVendorId: 'vend-1',
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: 'awaiting_invoice',
        },
      ],
    })
    expect(pending[0]?.vendorInvoice).toBe('Pending')

    const unlabeled = assemblePropertyHistory({
      ...base,
      tickets: [
        {
          id: 't-unlabeled',
          createdAt: '2026-08-28T12:00:00.000Z',
          assignedAt: '2026-08-28T13:00:00.000Z',
          completedAt: '2026-08-28T18:00:00.000Z',
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'hvac',
          description: 'Capacitor replaced',
          vendorWorkStatus: 'completed',
          assignedVendorId: 'vend-1',
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: 'pending_approval',
        },
      ],
      invoices: [
        {
          id: 'inv-blank',
          maintenanceRequestId: 't-unlabeled',
          vendorId: 'vend-1',
          invoiceNumber: null,
          totalCost: 100,
          status: 'submitted',
          submittedAt: '2026-08-28T19:00:00.000Z',
          approvedAt: null,
        },
      ],
    })
    expect(unlabeled[0]?.vendorInvoice).toBe('Invoice')
  })

  it('records completed rent without a paid_date as a tenant row', () => {
    const rows = assemblePropertyHistory({
      ...base,
      rentRuns: [
        {
          id: 'rent-no-date',
          propertyId: 'prop-1',
          unitId: 'unit-2b',
          residentId: 'res-1',
          status: 'completed',
          startedAt: '2026-09-01T12:00:00.000Z',
          completedAt: '2026-09-01T18:00:00.000Z',
          metadata: {
            billing_period: '2026-09',
            original_amount_due: 1950,
            rent_classification: 'paid',
            payment_intent: 'paid',
          },
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.contactType).toBe('tenant')
    expect(rows[0]?.contactName).toBe('Sarah Jenkins')
    expect(rows[0]?.paymentStatus).toBe('paid')
    expect(rows[0]?.vendorInvoice).toBe('Receipt')
  })

  it('labels paid rent without a method as Receipt', () => {
    const rows = assemblePropertyHistory({
      ...base,
      rentRuns: [
        {
          id: 'rent-receipt',
          propertyId: 'prop-1',
          unitId: 'unit-2b',
          residentId: 'res-1',
          status: 'completed',
          startedAt: '2026-09-01T12:00:00.000Z',
          completedAt: '2026-09-01T18:00:00.000Z',
          metadata: {
            billing_period: '2026-09',
            original_amount_due: 1850,
            rent_status: 'paid',
            admin_payment_received_at: '2026-09-01T18:00:00.000Z',
          },
        },
      ],
    })
    expect(rows[0]?.vendorInvoice).toBe('Receipt')
  })

  it('filters by unit and ignores conversation-only graph events', () => {
    const rows = assemblePropertyHistory({
      ...base,
      unitFilter: '2B',
      tickets: [
        {
          id: 't-2b',
          createdAt: '2026-08-10T12:00:00.000Z',
          assignedAt: null,
          completedAt: null,
          unit: '2B',
          unitId: 'unit-2b',
          building: '123 Main St',
          issueCategory: 'plumbing',
          description: 'Leak',
          vendorWorkStatus: 'unassigned',
          assignedVendorId: null,
          photoPaths: [],
          completionPhotoPaths: [],
          spendStatus: null,
        },
      ],
      graphEvents: [
        {
          id: 'g-sms',
          eventType: 'sms.delivered',
          createdAt: '2026-08-11T12:00:00.000Z',
          unitId: 'unit-2b',
          residentId: 'res-1',
          vendorId: null,
          propertyId: 'prop-1',
          maintenanceRequestId: null,
          workflowRunId: null,
          metadata: { message: 'SMS delivered' },
        },
        {
          id: 'g-pipe',
          eventType: 'workflow.act',
          createdAt: '2026-08-11T13:00:00.000Z',
          unitId: 'unit-2b',
          residentId: 'res-1',
          vendorId: null,
          propertyId: 'prop-1',
          maintenanceRequestId: null,
          workflowRunId: null,
          metadata: { message: 'Action taken' },
        },
      ],
    })

    expect(rows.some((row) => row.event === 'SMS delivered')).toBe(false)
    expect(rows.some((row) => row.sourceEntityType === 'operations_graph_event')).toBe(false)
    expect(rows).toHaveLength(0)
  })
})
