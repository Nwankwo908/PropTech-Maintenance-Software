import { describe, expect, it } from 'vitest'
import {
  HOME_CHECK_PHOTOS,
  homeCheckAsset,
  homeCheckComplete,
  homeCheckMetrics,
  homeCheckSummary,
  nearestHomeCheckVendors,
  parseHomeCheckCommand,
  parseHomeCheckPhotoReply,
  resolveHomeCheckTarget,
} from './homeCheck'

const answers = {
  warningSigns: false,
  warningDetails: '',
  lastService: '',
  waterHeaterLastService: 'June 2025',
  lastFilterChange: 'Unknown',
}
const label = {
  category: 'water_heater',
  identifiedItem: {
    type: 'Water heater',
    brand: 'Rheem',
    modelNumber: 'X1',
    serialNumber: 'AB2015',
  },
  estimatedAge: {
    value: 11,
    confidence: 'high' as const,
    basis: 'Estimated manufacture date encoded in serial',
  },
  condition: { rating: 'good', summary: 'Label only' },
  overallConfidence: 90,
}
const whole = { ...label, condition: { rating: 'fair', summary: 'Visible rust around base' } }
describe('Home Check scope and completion', () => {
  it('requires the four distinct photo slots rather than four arbitrary photos', () => {
    expect(homeCheckComplete(Array(4).fill('water_heater_label'))).toBe(false)
    expect(homeCheckComplete(HOME_CHECK_PHOTOS.map((photo) => photo.slot))).toBe(true)
    expect(homeCheckComplete(HOME_CHECK_PHOTOS.slice(0, 3).map((photo) => photo.slot))).toBe(false)
  })
  it('never guesses a property from a duplicated unit number', () => {
    const targets = ['Birch', 'Oak'].map((name, i) => ({
      propertyId: String(i),
      unitId: `unit${i}`,
      propertyName: name,
      address: `${i + 1} Main St`,
      unitLabel: '12A',
    }))
    expect(resolveHomeCheckTarget('12A', targets)).toBeNull()
    expect(resolveHomeCheckTarget('oak / 12a', targets)?.unitId).toBe('unit1')
    expect(resolveHomeCheckTarget('2 Main St / 12A', targets)?.propertyId).toBe('1')
    expect(resolveHomeCheckTarget('Oak', targets)).toBeNull()
  })
  it('defaults CHECK to landlord-authorized tenant capture, with explicit self/contractor routes', () => {
    expect(parseHomeCheckCommand('CHECK 12A')).toEqual({ role: 'tenant', target: '12A' })
    expect(parseHomeCheckCommand('CHECK SELF Oak / 12A')?.role).toBe('landlord')
    expect(parseHomeCheckCommand('CHECK CONTRACTOR Oak / 12A | window')?.role).toBe('contractor')
    expect(parseHomeCheckCommand('Can you check 12A?')).toBeNull()
  })
  it('requires an exact check and slot for MMS; short replies and trailing scope guesses are rejected', () => {
    expect(parseHomeCheckPhotoReply('hc-aabbccddeeff 3')).toEqual({
      reference: 'HC-AABBCCDDEEFF',
      slot: 'heating_label',
    })
    for (
      const value of [
        '3',
        'HC-AABBCCDDEEFF',
        'HC-AABBCCDDEEFF 5',
        'HC-AABBCCDDEEFF 1 Oak',
        'WO-1234 1',
      ]
    ) expect(parseHomeCheckPhotoReply(value)).toBeNull()
  })
})
describe('Home Check asset evidence', () => {
  it('separates label identification from visible condition and keeps even high-confidence ages estimated', () => {
    const asset = homeCheckAsset({
      system: 'water_heater',
      role: 'tenant',
      label,
      whole,
      labelPhotoId: 'label',
      wholePhotoId: 'whole',
      answers,
    })
    expect(asset.verified).toBe(false)
    expect(asset.fields.make).toMatchObject({
      value: 'Rheem',
      source: 'photo_text',
      capturedBy: 'tenant',
      photoIds: ['label'],
    })
    expect(asset.fields.condition.value).toContain('rust')
    expect(asset.fields.condition.photoIds).toEqual(['whole'])
    expect(asset.fields.approximateAge).toMatchObject({
      value: 11,
      estimated: true,
      confidence: 'high',
    })
    expect(asset.fields.lastService).toMatchObject({
      source: 'tenant',
      confidence: 'low',
      value: 'June 2025',
    })
  })
  it('does not infer condition from the label or identification from the whole-system photo', () => {
    const asset = homeCheckAsset({
      system: 'water_heater',
      role: 'contractor',
      label: null,
      whole,
      labelPhotoId: null,
      wholePhotoId: 'whole',
      answers,
    })
    expect(asset.fields.make.value).toBeNull()
    expect(asset.fields.approximateAge.value).toBeNull()
    expect(asset.fields.condition.value).toContain('rust')
  })
  it('rejects a photo of the wrong system, AC-only equipment, and impossible ages', () => {
    const wrong = homeCheckAsset({
      system: 'heating',
      role: 'landlord',
      label,
      whole,
      labelPhotoId: 'label',
      wholePhotoId: 'whole',
      answers,
    })
    expect(wrong.fields.make.value).toBeNull()
    const ac = {
      ...label,
      category: 'hvac',
      identifiedItem: { type: 'Air conditioner', brand: 'Carrier' },
    }
    expect(
      homeCheckAsset({
        system: 'heating',
        role: 'landlord',
        label: ac,
        whole: ac,
        labelPhotoId: 'label',
        wholePhotoId: 'whole',
        answers,
      }).fields.make.value,
    ).toBeNull()
    expect(
      homeCheckAsset({
        system: 'water_heater',
        role: 'landlord',
        label: { ...label, estimatedAge: { ...label.estimatedAge, value: -1 } },
        whole,
        labelPhotoId: 'label',
        wholePhotoId: 'whole',
        answers,
      }).fields.approximateAge.value,
    ).toBeNull()
  })
  it('reports unknown observations honestly and uses plain landlord-facing copy', () => {
    const summary = homeCheckSummary([], { ...answers, warningSigns: null })
    expect(summary).toContain('age unknown')
    expect(summary).toContain('not yet reported')
    expect(summary).not.toContain('No issues reported')
    expect(summary).not.toMatch(/\bAI\b/)
  })
  it('does not copy an unscoped SMS service date onto both systems', () => {
    const asset = homeCheckAsset({
      system: 'heating',
      role: 'contractor',
      label: null,
      whole: null,
      labelPhotoId: null,
      wholePhotoId: null,
      answers: { ...answers, lastService: 'June 2025' },
    })
    expect(asset.fields.lastService.value).toBeNull()
    expect(asset.fields.lastService.basis).toContain('equipment unspecified')
  })
})
describe('Home Check routing and outcomes', () => {
  it('selects nearest from actual coordinates and refuses unknown locations', () => {
    const vendors = [{ id: 'far', latitude: 41, longitude: -74 }, {
      id: 'near',
      latitude: 40.01,
      longitude: -74,
    }, { id: 'unknown', latitude: null, longitude: null }]
    expect(
      nearestHomeCheckVendors({ latitude: 40, longitude: -74 }, vendors).map((vendor) => vendor.id),
    ).toEqual(['near', 'far'])
    expect(nearestHomeCheckVendors({ latitude: null, longitude: null }, vendors)).toEqual([])
  })
  it('separates funnel outcomes and conversion denominators by the completion role', () => {
    const base = {
      sent_at: '2026-10-13T00:00:00Z',
      created_at: '2026-10-13T00:00:00Z',
      opened_at: null,
      completed_at: null,
      confirmed_at: null,
      labels_readable: false,
      issue_ticket_id: null,
    }
    const metrics = homeCheckMetrics([
      {
        ...base,
        role: 'tenant',
        opened_at: base.sent_at,
        completed_at: '2026-10-13T00:02:00Z',
        labels_readable: true,
        issue_ticket_id: 'issue',
        approved: true,
      },
      { ...base, role: 'tenant' },
      { ...base, role: 'contractor' },
    ])
    expect(metrics[0]).toMatchObject({
      sent: 2,
      opened: 1,
      completed: 1,
      labelReadable: 1,
      confirmed: 0,
      averageMinutes: 2,
      issueShare: 1,
      approvedJobShare: 1,
    })
    expect(metrics[1]).toMatchObject({ completed: 0, issueShare: null })
    expect(metrics[2]).toMatchObject({ sent: 0, averageMinutes: null })
  })
})
