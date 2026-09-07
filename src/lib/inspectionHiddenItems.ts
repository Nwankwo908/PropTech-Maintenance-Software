import { getActiveLandlordId } from '@/lib/activeLandlord'

type HiddenInspectionItems = {
  photoIds: string[]
  assetIds: string[]
}

const memoryStore = new Map<string, HiddenInspectionItems>()

function storageKey(building: string): string {
  const landlordId = getActiveLandlordId() ?? 'none'
  return `ulo.inspectionHidden.${landlordId}.${building.trim().toLowerCase()}`
}

function canUseSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined'
}

function readHidden(building: string): HiddenInspectionItems {
  if (!building) return { photoIds: [], assetIds: [] }
  const key = storageKey(building)
  if (canUseSessionStorage()) {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return memoryStore.get(key) ?? { photoIds: [], assetIds: [] }
      const parsed = JSON.parse(raw) as Partial<HiddenInspectionItems>
      return {
        photoIds: Array.isArray(parsed.photoIds) ? parsed.photoIds.map(String) : [],
        assetIds: Array.isArray(parsed.assetIds) ? parsed.assetIds.map(String) : [],
      }
    } catch {
      return memoryStore.get(key) ?? { photoIds: [], assetIds: [] }
    }
  }
  return memoryStore.get(key) ?? { photoIds: [], assetIds: [] }
}

function writeHidden(building: string, next: HiddenInspectionItems): void {
  if (!building) return
  const key = storageKey(building)
  memoryStore.set(key, next)
  if (!canUseSessionStorage()) return
  sessionStorage.setItem(key, JSON.stringify(next))
}

export function listHiddenInspectionItems(building: string): HiddenInspectionItems {
  const hidden = readHidden(building)
  return {
    photoIds: [...new Set(hidden.photoIds)],
    assetIds: [...new Set(hidden.assetIds)],
  }
}

export function hideInspectionItems(
  building: string,
  add: { photoIds?: string[]; assetIds?: string[] },
): HiddenInspectionItems {
  const prev = readHidden(building)
  const next = {
    photoIds: [...new Set([...prev.photoIds, ...(add.photoIds ?? [])])],
    assetIds: [...new Set([...prev.assetIds, ...(add.assetIds ?? [])])],
  }
  writeHidden(building, next)
  return next
}

export function isHiddenInspectionPhoto(
  building: string,
  photo: { id: string; unitAssetId?: string | null },
): boolean {
  const hidden = readHidden(building)
  if (hidden.photoIds.includes(photo.id)) return true
  if (photo.unitAssetId && hidden.assetIds.includes(photo.unitAssetId)) return true
  return false
}

export function isHiddenInspectionAsset(
  building: string,
  asset: { id: string; metadata?: Record<string, unknown> | null },
): boolean {
  const hidden = readHidden(building)
  if (hidden.assetIds.includes(asset.id)) return true
  const photoId = asset.metadata?.photoId
  return typeof photoId === 'string' && hidden.photoIds.includes(photoId)
}
