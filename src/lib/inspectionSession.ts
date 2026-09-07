export const INSPECTION_SESSION_CHANGED_EVENT = 'ulo:inspection-session-changed'

export function notifyInspectionSessionChanged(building: string): void {
  if (typeof window === 'undefined' || !building.trim()) return
  window.dispatchEvent(
    new CustomEvent(INSPECTION_SESSION_CHANGED_EVENT, {
      detail: { building: building.trim() },
    }),
  )
}

export function isInspectionReportPhoto(photo: {
  contentType?: string | null
  fileName?: string | null
  aiResult?: unknown
}): boolean {
  const result = photo.aiResult
  if (result && typeof result === 'object') {
    const packed = result as { _source?: unknown; mode?: unknown }
    if (packed._source === 'inspection_report' || packed.mode === 'document') return true
  }
  const type = (photo.contentType ?? '').toLowerCase()
  const name = (photo.fileName ?? '').toLowerCase()
  return type.includes('pdf') || name.endsWith('.pdf')
}

/** Newest-first session ids; write target is a session that already has photos, else newest. */
export function pickBuildingInspectionWriteSessionId(
  sessionIdsNewestFirst: string[],
  photos: Array<{ assessmentId: string }>,
): string | null {
  if (sessionIdsNewestFirst.length === 0) return null
  const withPhotos = sessionIdsNewestFirst.find((id) =>
    photos.some((photo) => photo.assessmentId === id),
  )
  return withPhotos ?? sessionIdsNewestFirst[0] ?? null
}

export function hasPersistedInspectionData(input: {
  photoCount: number
  assetCount: number
}): boolean {
  return input.photoCount > 0 || input.assetCount > 0
}

/** Session overlay may hide optimistic local rows only — persisted photos stay visible. */
export function inspectionPhotosForDisplay<T extends { id: string; unitAssetId?: string | null }>(
  building: string,
  photos: T[],
  isHiddenLocal: (building: string, photo: T) => boolean,
): T[] {
  return photos.filter((photo) => {
    if (!photo.id.startsWith('local-')) return true
    return !isHiddenLocal(building, photo)
  })
}
