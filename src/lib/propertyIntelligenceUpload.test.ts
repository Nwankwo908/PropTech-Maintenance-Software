import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadDashboardEquipmentPhoto } from '@/api/homeCheck'
import { HOME_CHECK_CHANGED_EVENT } from '@/lib/homeCheckEvents'
import {
  classifyPropertyIntelligenceFile,
  partitionPropertyIntelligenceFiles,
  savePropertyIntelligencePhotos,
} from '@/lib/propertyIntelligenceUpload'

vi.mock('@/api/homeCheck', () => ({
  uploadDashboardEquipmentPhoto: vi.fn(async () => ({ checkId: 'check', slot: 'water_heater_label' })),
}))

const pdf = { name: 'report.pdf', type: 'application/pdf', size: 1000 }
const photo = { name: 'heater.jpg', type: 'image/jpeg', size: 1000 }
const junk = { name: 'notes.docx', type: 'application/msword', size: 1000 }

describe('property intelligence uploads', () => {
  beforeEach(() => {
    vi.mocked(uploadDashboardEquipmentPhoto).mockClear()
  })

  it('keeps PDFs as inspection reports and sends photos to Home Check', () => {
    expect(classifyPropertyIntelligenceFile(pdf)).toBe('inspection_report')
    expect(classifyPropertyIntelligenceFile(photo)).toBe('equipment_photo')
    expect(classifyPropertyIntelligenceFile({ name: 'scan.PNG', type: '' })).toBe('equipment_photo')
    const split = partitionPropertyIntelligenceFiles([pdf, photo, junk], 25 * 1024 * 1024)
    expect(split.reports).toEqual([pdf])
    expect(split.photos).toEqual([photo])
    expect(split.rejected).toHaveLength(1)
  })

  it('runs the same photo analysis from either upload entry', async () => {
    const saved: string[] = []
    async function uploadLikeEitherCard(
      files: Array<{ name: string; type: string; size: number }>,
      propertyId: string,
    ) {
      const { reports, photos } = partitionPropertyIntelligenceFiles(files, 25 * 1024 * 1024)
      for (const report of reports) saved.push(report.name)
      if (photos.length) {
        await savePropertyIntelligencePhotos(propertyId, photos as unknown as File[])
      }
    }
    await uploadLikeEitherCard([pdf, photo], 'property')
    await uploadLikeEitherCard([photo], 'property')
    expect(saved).toEqual(['report.pdf'])
    expect(uploadDashboardEquipmentPhoto).toHaveBeenCalledTimes(2)
    expect(uploadDashboardEquipmentPhoto).toHaveBeenCalledWith({
      propertyId: 'property',
      file: photo,
    })
    expect(HOME_CHECK_CHANGED_EVENT).toBe('ulo:home-check-changed')
  })
})
