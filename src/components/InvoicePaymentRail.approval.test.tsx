import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InvoicePaymentRail, type InvoicePaymentReview } from './InvoicePaymentRail'

const review: InvoicePaymentReview = {
  invoiceId: '11111111-1111-4111-8111-111111111111',
  maintenanceRequestId: '22222222-2222-4222-8222-222222222222',
  totalCost: 240,
  laborCost: 200,
  materialCost: 40,
  taxAmount: 0,
  unit: '1',
  building: '123 Main',
  residentName: 'Sam',
  vendorName: 'Apex Plumbing',
  vendorId: '33333333-3333-4333-8333-333333333333',
  issueCategory: 'plumbing',
  submittedAt: '2026-10-25T12:00:00.000Z',
  rating: null,
  invoiceNumber: 'INV-240',
  documentPath: 'invoices/apex-240.pdf',
  propertyType: 'single_family',
  vendorRating: null,
  vendorReviewCount: null,
}

function markup(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node)
}

describe('invoice review panel', () => {
  it('shows the invoice and an amount approval when payments are disabled', () => {
    const html = markup(
      createElement(InvoicePaymentRail, {
        open: true,
        review,
        paymentsEnabled: false,
        saving: false,
        error: null,
        onClose: () => {},
        onApprove: () => {},
        onReject: () => {},
      }),
    )
    expect(html).toContain('Review Invoice')
    expect(html).toContain('Apex Plumbing')
    expect(html).toContain('123 Main')
    expect(html).not.toMatch(/Unit 1|Home/)
    expect(html).toContain('INV-240')
    expect(html).toContain('apex-240.pdf')
    expect(html).toContain('Total Amount')
    expect(html).toContain('$240.00')
    expect(html).toContain('Approve $240')
    expect(html).not.toContain('Pay now')
    expect(html).not.toContain('Confirm &amp; Pay')
  })

  it('shows the approval result and hides pay and queue copy', () => {
    const html = markup(
      createElement(InvoicePaymentRail, {
        open: true,
        review: null,
        paymentsEnabled: false,
        approvalSuccess: { vendorName: 'Apex Plumbing', amountLabel: '$240' },
        saving: false,
        error: null,
        onClose: () => {},
        onApprove: () => {},
        onReject: () => {},
      }),
    )
    expect(html).toContain('Invoice approved')
    expect(html).toContain('You approved Apex Plumbing&#x27;s $240 invoice. No payment was made.')
    expect(html).toContain('Done')
    expect(html).not.toMatch(/Resolved|decision queue|Payment Sent|Pay now/i)
  })

  it('keeps the invoice visible and shows the error when approval fails', () => {
    const html = markup(
      createElement(InvoicePaymentRail, {
        open: true,
        review,
        paymentsEnabled: false,
        saving: false,
        error: 'Could not approve invoice',
        onClose: () => {},
        onApprove: () => {},
        onReject: () => {},
      }),
    )
    expect(html).toContain('Could not approve invoice')
    expect(html).toContain('Approve $240')
    expect(html).toContain('Apex Plumbing')
  })

  it('disables approval while a submission is in progress', () => {
    const onApprove = vi.fn()
    const html = markup(
      createElement(InvoicePaymentRail, {
        open: true,
        review,
        paymentsEnabled: false,
        saving: true,
        error: null,
        onClose: () => {},
        onApprove,
        onReject: () => {},
      }),
    )
    expect(html).toContain('Approving…')
    expect(html).toContain('disabled')
    expect(onApprove).not.toHaveBeenCalled()
  })
})
