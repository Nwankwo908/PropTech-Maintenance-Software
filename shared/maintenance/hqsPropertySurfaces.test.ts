import { describe, expect, it } from 'vitest'
import {
  hqsPmDueAtIso,
  planHqsHomeDataGraphIngest,
  planHqsPmComplianceTask,
  unitBuildingMatchesPropertyLabel,
} from './hqsPropertySurfaces.ts'

describe('unitBuildingMatchesPropertyLabel', () => {
  it('matches full address label to short unit building', () => {
    expect(
      unitBuildingMatchesPropertyLabel(
        '646 Bartlett',
        '646 Bartlett, Baltimore, MD 21218',
      ),
    ).toBe(true)
    expect(
      unitBuildingMatchesPropertyLabel(
        '646 Bartlett, Baltimore, MD 21218',
        '646 Bartlett',
      ),
    ).toBe(true)
  })

  it('rejects different street numbers', () => {
    expect(
      unitBuildingMatchesPropertyLabel('644 Bartlett', '646 Bartlett, Baltimore, MD 21218'),
    ).toBe(false)
  })
})

describe('planHqsPmComplianceTask', () => {
  it('uses reinspection date and tags inspection_report_id', () => {
    const plan = planHqsPmComplianceTask({
      inspectionReportId: '8ac8ee35-9f78-44ec-85a8-97b90442e54c',
      sourceDocumentId: 'doc-1',
      unitLabel: '1',
      building: '646 Bartlett',
      reinspectionDate: '2026-10-15',
      emergencyItemCount: 2,
      standardItemCount: 5,
    })
    expect(plan.taskKind).toBe('inspection')
    expect(plan.title).toContain('Unit 1')
    expect(plan.dueAtIso).toBe(hqsPmDueAtIso({ reinspectionDate: '2026-10-15' }))
    expect(plan.metadata.inspection_report_id).toBe(
      '8ac8ee35-9f78-44ec-85a8-97b90442e54c',
    )
    expect(plan.metadata.source).toBe('hqs_letter')
  })
})

describe('planHqsHomeDataGraphIngest', () => {
  it('uses manual provider and stable hqs record id', () => {
    const plan = planHqsHomeDataGraphIngest({
      inspectionReportId: '8ac8ee35-9f78-44ec-85a8-97b90442e54c',
      sourceDocumentId: 'doc-1',
      fileName: 'hqs-fail.pdf',
    })
    expect(plan.provider).toBe('manual')
    expect(plan.providerRecordId).toBe(
      'hqs-letter:8ac8ee35-9f78-44ec-85a8-97b90442e54c',
    )
    expect(plan.raw.kind).toBe('hqs_inspection_letter')
  })
})
