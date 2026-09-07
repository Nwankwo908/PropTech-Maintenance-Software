import { describe, expect, it } from 'vitest'
import {
  hasPersistedInspectionData,
  inspectionPhotosForDisplay,
  isInspectionReportPhoto,
  pickBuildingInspectionWriteSessionId,
} from '@/lib/inspectionSession'

describe('inspectionSession persistence helpers', () => {
  it('treats document-mode and inspection_report photos as reports', () => {
    expect(
      isInspectionReportPhoto({
        fileName: 'unit.jpg',
        contentType: 'image/jpeg',
        aiResult: { mode: 'document' },
      }),
    ).toBe(true)
    expect(
      isInspectionReportPhoto({
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        aiResult: null,
      }),
    ).toBe(true)
    expect(
      isInspectionReportPhoto({
        fileName: 'fridge.jpg',
        contentType: 'image/jpeg',
        aiResult: { _source: 'inspection_report' },
      }),
    ).toBe(true)
    expect(
      isInspectionReportPhoto({
        fileName: 'fridge.jpg',
        contentType: 'image/jpeg',
        aiResult: { category: 'appliance' },
      }),
    ).toBe(false)
  })

  it('returns photos from every session while writing to a session that already has photos', () => {
    const ids = ['new-empty', 'older-with-photos']
    const photos = [{ assessmentId: 'older-with-photos' }]
    expect(pickBuildingInspectionWriteSessionId(ids, photos)).toBe('older-with-photos')
    expect(pickBuildingInspectionWriteSessionId(['only'], [])).toBe('only')
  })

  it('treats the inspection section as populated when photos or assets exist', () => {
    expect(hasPersistedInspectionData({ photoCount: 0, assetCount: 0 })).toBe(false)
    expect(hasPersistedInspectionData({ photoCount: 1, assetCount: 0 })).toBe(true)
    expect(hasPersistedInspectionData({ photoCount: 0, assetCount: 2 })).toBe(true)
  })

  it('does not hide persisted photos with the session overlay', () => {
    const photos = [
      { id: 'db-1', unitAssetId: null },
      { id: 'local-gone', unitAssetId: null },
    ]
    const visible = inspectionPhotosForDisplay('12 Main', photos, (_building, photo) =>
      photo.id === 'db-1' || photo.id === 'local-gone',
    )
    expect(visible.map((p) => p.id)).toEqual(['db-1'])
  })
})
