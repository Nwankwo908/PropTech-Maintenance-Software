import { describe, expect, it } from 'vitest'
import {
  formatEstimateDollars,
  humanizeVendorJobDescription,
  resolveVendorJobNextStep,
} from './vendorJobNextStep'

describe('resolveVendorJobNextStep', () => {
  const base = {
    status: 'accepted' as string | null,
    estimateStatus: null as string | null,
    estimateSubmitted: false,
    estimateApproved: false,
    completionPhotosUploaded: false,
    invoiceStatus: null as string | null,
    invoiceSubmitted: false,
  }

  it('pending_accept → accept', () => {
    const step = resolveVendorJobNextStep({ ...base, status: 'pending_accept' })
    expect(step.kind).toBe('accept')
    expect(step.progress.estimate).toBe('current')
  })

  it('accepted without estimate → submit_estimate', () => {
    const step = resolveVendorJobNextStep({ ...base, status: 'accepted' })
    expect(step.kind).toBe('submit_estimate')
  })

  it('estimate pending → waiting_estimate_approval (no CTA kind)', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      estimateSubmitted: true,
      estimateStatus: 'pending_approval',
    })
    expect(step.kind).toBe('waiting_estimate_approval')
    expect(step.progress.estimate).toBe('current')
  })

  it('estimate approved → start_work', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      estimateSubmitted: true,
      estimateApproved: true,
      estimateStatus: 'approved',
    })
    expect(step.kind).toBe('start_work')
    expect(step.progress.estimate).toBe('done')
    expect(step.progress.start_work).toBe('current')
    expect(step.comingNext).toEqual(['photos', 'invoice'])
  })

  it('in_progress → add_photos', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      status: 'in_progress',
      estimateApproved: true,
      estimateStatus: 'approved',
    })
    expect(step.kind).toBe('add_photos')
    expect(step.progress.start_work).toBe('done')
    expect(step.progress.photos).toBe('current')
  })

  it('photos uploaded → submit_invoice', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      status: 'in_progress',
      estimateApproved: true,
      completionPhotosUploaded: true,
    })
    expect(step.kind).toBe('submit_invoice')
    expect(step.progress.photos).toBe('done')
    expect(step.progress.invoice).toBe('current')
  })

  it('invoice submitted → waiting_payment', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      status: 'in_progress',
      estimateApproved: true,
      completionPhotosUploaded: true,
      invoiceSubmitted: true,
      invoiceStatus: 'submitted',
    })
    expect(step.kind).toBe('waiting_payment')
  })

  it('completed → job_complete', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      status: 'completed',
      estimateApproved: true,
      completionPhotosUploaded: true,
      invoiceSubmitted: true,
      invoiceStatus: 'approved',
    })
    expect(step.kind).toBe('job_complete')
    expect(step.progress.invoice).toBe('done')
  })

  it('declined → declined', () => {
    expect(resolveVendorJobNextStep({ ...base, status: 'declined' }).kind).toBe(
      'declined',
    )
  })

  it('rejected estimate → submit_estimate again', () => {
    const step = resolveVendorJobNextStep({
      ...base,
      estimateStatus: 'rejected',
      estimateSubmitted: false,
      estimateApproved: false,
    })
    expect(step.kind).toBe('submit_estimate')
  })
})

describe('formatEstimateDollars', () => {
  it('formats whole dollars', () => {
    expect(formatEstimateDollars(200)).toBe('$200')
    expect(formatEstimateDollars(200.4)).toBe('$200')
    expect(formatEstimateDollars(null)).toBeNull()
    expect(formatEstimateDollars(0)).toBeNull()
  })
})

describe('humanizeVendorJobDescription', () => {
  it('strips intake labels and maps entry', () => {
    const result = humanizeVendorJobDescription({
      description:
        'My pipes burst\nTenant update: No\nAffected area: basement.\nEntry if not home: No.',
      issueHeadline: 'Burst pipe',
      entryOkIfAbsent: false,
    })
    expect(result.title).toBe('Burst pipe')
    expect(result.residentReport).toBe('My pipes burst')
    expect(result.affectedArea?.toLowerCase()).toBe('basement')
    expect(result.accessFromIntake).toBe('must_be_home')
    expect(result.residentReport).not.toMatch(/Tenant update/i)
    expect(result.residentReport).not.toMatch(/Entry if not home/i)
  })

  it('falls back to first report line when no headline', () => {
    const result = humanizeVendorJobDescription({
      description: 'Kitchen sink is leaking badly.\nAffected area: kitchen.',
      fallbackTitle: 'Plumbing',
    })
    expect(result.title).toMatch(/Kitchen sink/i)
    expect(result.affectedArea?.toLowerCase()).toBe('kitchen')
  })

  it('maps entry_ok_if_absent true', () => {
    const result = humanizeVendorJobDescription({
      description: 'Outlet sparking',
      entryOkIfAbsent: true,
    })
    expect(result.accessFromIntake).toBe('ok_if_away')
  })
})
