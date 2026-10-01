import { describe, expect, it } from 'vitest'
import {
  HQS_FIXTURE_DOC1_TEXT,
  HQS_FIXTURE_DOC2_TEXT,
  HQS_FIXTURE_PHOTO_OCR_DOC2,
} from './hqsInspectionLetter.fixtures.ts'
import {
  buildHqsLetterConfirmSummarySms,
  classifyHqsInspectionLetter,
  extractHqsInspectionLetter,
  ownerResponsibilityDeficiencies,
  resolveHqsDeficiencyDueDateIso,
  splitHqsDeficiencySections,
} from './hqsInspectionLetter.ts'

describe('classifyHqsInspectionLetter', () => {
  it('classifies Doc 1 / Doc 2 without a landlord keyword', () => {
    expect(classifyHqsInspectionLetter(HQS_FIXTURE_DOC1_TEXT).isHqsLetter).toBe(true)
    expect(classifyHqsInspectionLetter(HQS_FIXTURE_DOC2_TEXT).isHqsLetter).toBe(true)
  })

  it('rejects unrelated MMS body text', () => {
    expect(
      classifyHqsInspectionLetter('Kitchen sink is leaking again under the cabinet').isHqsLetter,
    ).toBe(false)
  })
})

describe('Doc 1 fixture — abatement + emergency', () => {
  const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC1_TEXT)

  it('extracts ids, abatement, and counts', () => {
    expect(extraction.isHqsLetter).toBe(true)
    expect(extraction.ownerIdExternal).toBe('OWN-44821')
    expect(extraction.tenantIdExternal).toBe('TEN-90210')
    expect(extraction.inspectionIdExternal).toBe('INSP-77102')
    expect(extraction.isAbated).toBe(true)
    expect(extraction.letterType).toBe('hap_abatement')
    expect(extraction.reinspectionDate).toBeNull()
    expect(extraction.emergencyItemCount).toBe(1)
    expect(extraction.standardItemCount).toBe(11)
    expect(extraction.deficiencies[0]?.failItemCategory).toMatch(/Gas Range/i)
    expect(extraction.deficiencies[0]?.section).toBe('emergency')
  })

  it('falls back due dates to inspection date + 30 days for standard items', () => {
    const standard = extraction.deficiencies.find((d) => d.section === 'standard')!
    expect(resolveHqsDeficiencyDueDateIso(extraction, standard)).toBe('2026-09-11')
  })

  it('summary mentions abatement for the separate alert path', () => {
    const sms = buildHqsLetterConfirmSummarySms({
      extraction,
      unitLabel: '1',
      propertyLabel: '646 Bartlett',
    })
    expect(sms).toMatch(/Abatement: YES/i)
    expect(sms).toMatch(/Emergency items: 1/)
    expect(sms).toMatch(/Standard items: 11/)
  })
})

describe('Doc 2 fixture — no emergency section', () => {
  const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC2_TEXT)

  it('has zero emergency items and no emergency header', () => {
    const sections = splitHqsDeficiencySections(HQS_FIXTURE_DOC2_TEXT)
    expect(sections.hasEmergencyHeader).toBe(false)
    expect(sections.emergencyBody).toBeNull()
    expect(extraction.emergencyItemCount).toBe(0)
    expect(extraction.standardItemCount).toBe(13)
    expect(extraction.isAbated).toBe(false)
    expect(extraction.letterType).toBe('standard_fail')
    expect(extraction.reinspectionDate).toBe('2026-09-28')
    expect(extraction.reinspectionFee).toBe(75)
  })

  it('uses stated reinspection date for standard due dates (not +30 fallback)', () => {
    const standard = extraction.deficiencies.find((d) => d.section === 'standard')!
    expect(resolveHqsDeficiencyDueDateIso(extraction, standard)).toBe('2026-09-28')
  })
})

describe('photo OCR path', () => {
  it('routes photo OCR text through the same extract as PDF text', () => {
    const fromPhoto = extractHqsInspectionLetter(HQS_FIXTURE_PHOTO_OCR_DOC2)
    const fromPdf = extractHqsInspectionLetter(HQS_FIXTURE_DOC2_TEXT)
    expect(fromPhoto).toEqual(fromPdf)
  })
})

describe('owner responsibility filter', () => {
  it('returns only owner rows for work-order creation', () => {
    const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC1_TEXT)
    const owner = ownerResponsibilityDeficiencies(extraction)
    expect(owner.length).toBe(12)
    expect(owner.every((r) => r.responsibility === 'owner')).toBe(true)
  })
})
