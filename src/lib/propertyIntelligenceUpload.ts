import { uploadDashboardEquipmentPhoto } from '@/api/homeCheck'
import { notifyHomeCheckChanged } from '@/lib/homeCheckEvents'

export type PropertyIntelligenceUploadKind = 'inspection_report' | 'equipment_photo'

/** PDFs stay inspection reports. Photos run a Home Check. */
export function classifyPropertyIntelligenceFile(file: {
  name: string
  type: string
}): PropertyIntelligenceUploadKind | null {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'inspection_report'
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name)) {
    return 'equipment_photo'
  }
  return null
}

export function partitionPropertyIntelligenceFiles<T extends { name: string; type: string; size: number }>(
  files: readonly T[],
  maxBytes: number,
): { reports: T[]; photos: T[]; rejected: string[] } {
  const reports: T[] = []
  const photos: T[] = []
  const rejected: string[] = []
  for (const file of files) {
    if (file.size > maxBytes) {
      rejected.push(`${file.name} is larger than ${Math.round(maxBytes / (1024 * 1024))}MB.`)
      continue
    }
    const kind = classifyPropertyIntelligenceFile(file)
    if (kind === 'inspection_report') reports.push(file)
    else if (kind === 'equipment_photo') photos.push(file)
    else rejected.push('Use a PDF report or a JPG, PNG, WEBP, or HEIC photo.')
  }
  return { reports, photos, rejected }
}

/** Photos are analyzed one at a time so each fills the next open equipment slot. */
export async function savePropertyIntelligencePhotos(
  propertyId: string,
  photos: readonly File[],
): Promise<number> {
  for (const photo of photos) {
    await uploadDashboardEquipmentPhoto({ propertyId, file: photo })
  }
  if (photos.length) notifyHomeCheckChanged(propertyId)
  return photos.length
}
