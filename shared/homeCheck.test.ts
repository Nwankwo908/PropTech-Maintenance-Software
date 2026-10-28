import { describe, expect, it } from 'vitest'
import {
  HOME_CHECK_PHOTOS,
  formatHomeCheckLocation,
  homeCheckAsset,
  homeCheckAssetStatusLabel,
  homeCheckComplete,
  nextHomeCheckSlot,
  homeCheckReceivedCount,
  homeCheckFieldBasis,
  homeCheckFollowUpReason,
  homeCheckMetrics,
  homeCheckSummary,
  homeCheckWorkOrderTitle,
  nearestHomeCheckVendors,
  parseHomeCheckCommand,
  parseHomeCheckGuideStart,
  parseHomeCheckPhotoReply,
  resolveHomeCheckTarget,
  supportedHomeCheckPhotoWarning,
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
    expect(homeCheckReceivedCount(Array(4).fill('water_heater_label'))).toBe(1)
    expect(homeCheckReceivedCount(['water_heater_label', 'not_a_slot', 'heating_label'])).toBe(2)
    expect(homeCheckComplete(HOME_CHECK_PHOTOS.map((photo) => photo.slot))).toBe(true)
    expect(homeCheckComplete(HOME_CHECK_PHOTOS.slice(0, 3).map((photo) => photo.slot))).toBe(false)
    expect(nextHomeCheckSlot([])).toBe('water_heater_label')
    expect(nextHomeCheckSlot(['water_heater_label', 'not_a_slot'])).toBe('water_heater_whole')
    expect(nextHomeCheckSlot(HOME_CHECK_PHOTOS.map((photo) => photo.slot))).toBeNull()
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
  it('supports inspection initiation, explicit recipients and a scope-help request', () => {
    for (
      const text of [
        'INSPECT Birch / 12A',
        'inspection Birch / 12A',
        'HOME CHECK Birch / 12A',
        'start an inspection for Birch / 12A',
      ]
    ) {
      expect(parseHomeCheckCommand(text)).toEqual({ role: 'landlord', target: 'Birch / 12A' })
    }
    expect(parseHomeCheckCommand('INSPECT TENANT Birch / 12A')).toEqual({
      role: 'tenant',
      target: 'Birch / 12A',
    })
    expect(parseHomeCheckCommand('INSPECT CONTRACTOR Birch / 12A | window')).toEqual({
      role: 'contractor',
      target: 'Birch / 12A | window',
    })
    expect(parseHomeCheckCommand('INSPECT')).toEqual({ role: 'landlord', target: '' })
    expect(parseHomeCheckCommand('CHECK')).toEqual({ role: 'tenant', target: '' })
    expect(parseHomeCheckCommand('inspection results for my heater')).toEqual({
      role: 'landlord',
      target: 'results for my heater',
    })
    expect(parseHomeCheckCommand('Can you inspect my apartment?')).toBeNull()
    expect(parseHomeCheckGuideStart('home check 12 Oak')).toEqual({
      role: null,
      target: '12 Oak',
      window: null,
    })
    expect(parseHomeCheckGuideStart('can someone check the equipment at Maple')).toEqual({
      role: null,
      target: 'Maple',
      window: null,
    })
    expect(parseHomeCheckGuideStart('CHECK 12A')?.role).toBe('tenant')
    expect(parseHomeCheckGuideStart('INSPECT SELF Birch / 12A')?.role).toBe('landlord')
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
    const handler = {
      ...label,
      category: 'hvac',
      identifiedItem: {
        type: 'air handler',
        brand: 'ICP',
        modelNumber: 'END4X42L17A1',
        serialNumber: 'X132753655',
      },
      estimatedAge: {
        value: 13,
        confidence: 'high' as const,
        basis: 'Manufacture date July 2013. Age is 13 years as of October 22, 2026.',
      },
    }
    const kept = homeCheckAsset({
      system: 'heating',
      role: 'landlord',
      label: handler,
      whole: handler,
      labelPhotoId: 'label',
      wholePhotoId: 'whole',
      answers,
    })
    expect(kept.fields.model.value).toBe('END4X42L17A1')
    expect(kept.fields.approximateAge.value).toBe(13)
    expect(homeCheckAsset({
      system: 'heating',
      role: 'landlord',
      label: { ...handler, manufactureDate: { year: 2013, month: 7 } },
      whole: handler,
      labelPhotoId: 'label',
      wholePhotoId: 'whole',
      answers,
    }).manufactureDate).toEqual({ year: 2013, month: 7 })
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

describe('Home Check review, follow-up, and single-family wording', () => {
  it('omits the stored Home label and keeps a real unit', () => {
    expect(formatHomeCheckLocation('123 Main', 'Home')).toBe('123 Main')
    expect(formatHomeCheckLocation('Birch', '12A')).toBe('Birch · Unit 12A')
  })

  it('does not call unknown plate fields verified after the review is saved', () => {
    const unknown = {
      verified: true,
      fields: { model: { value: null }, serial: { value: null } },
    }
    const verified = {
      verified: true,
      fields: { model: { value: 'END4X42L17A1' }, serial: { value: 'X132753655' } },
    }
    expect(homeCheckAssetStatusLabel({ verified: false, fields: unknown.fields })).toBe('Unverified')
    expect(homeCheckAssetStatusLabel(unknown)).toBe('Review confirmed · details unknown')
    expect(homeCheckAssetStatusLabel(verified)).toBe('Details verified')
    expect(homeCheckFieldBasis({
      value: null,
      basis: 'Landlord checked the data plate and supplied this text.',
    })).toBeNull()
    expect(homeCheckFieldBasis({
      value: null,
      basis: 'The manufacture date is unclear, so age stays unknown.',
    })).toBe('The manufacture date is unclear, so age stays unknown.')
  })

  it('opens a follow-up for a reported problem or a supported photo finding only', () => {
    expect(supportedHomeCheckPhotoWarning('The gas furnace burner is visible')).toBeNull()
    expect(supportedHomeCheckPhotoWarning('There is a gas smell near the furnace')).toMatch(/gas smell/)
    expect(homeCheckFollowUpReason({
      warningSigns: false,
      detectedWarning: 'The gas furnace burner is visible',
    })).toBeNull()
    expect(homeCheckFollowUpReason({
      warningSigns: false,
      detectedWarning: 'There is a gas smell near the furnace',
    })).toMatch(/gas smell/)
    expect(homeCheckFollowUpReason({
      warningSigns: true,
      warningDetails: 'Odd noise from the furnace',
    })).toMatch(/Odd noise/)
    expect(homeCheckWorkOrderTitle(
      'Home Check: four photos of the water heater and furnace or boiler. Observation only; no repairs or paid work authorized.',
    )).toBe('Home Check')
    expect(homeCheckWorkOrderTitle('Home Check follow-up. A photo showed a gas smell.', 'home_check_warning'))
      .toBe('Home Check follow-up')
  })
})
