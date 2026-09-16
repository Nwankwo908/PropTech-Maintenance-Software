import { roofCoveringIdentity } from "./normalize.ts"

export type InspectionAssetMatchCandidate = {
  id: string
  appliance_type?: string | null
  brand: string | null
  model: string | null
  estimated_age_years?: number | null
  detection_source?: string | null
  metadata: Record<string, unknown> | null
}

function meta(row: InspectionAssetMatchCandidate): Record<string, unknown> {
  return row.metadata && typeof row.metadata === "object" ? row.metadata : {}
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function rowSlotKey(row: InspectionAssetMatchCandidate): string {
  const m = meta(row)
  const slot = String(m.slotKey ?? "").trim()
  if (slot) return slot
  const registry = String(m.registryAssetType ?? "").trim()
  const subtype = String(m.applianceSubtype ?? "").trim()
  if (registry === "appliance" && subtype) return `appliance:${subtype}`
  return registry
}

function isSharedCatalogSlot(slotKey: string): boolean {
  return slotKey === "roof" || slotKey.startsWith("appliance:")
}

/** True when this catalog row is the same finding as the incoming extract. */
export function inspectionAssetMatchesFinding(
  row: InspectionAssetMatchCandidate,
  query: {
    itemType: string
    slotKey?: string | null
  },
): boolean {
  const type = norm(query.itemType)
  const rowType = norm(row.appliance_type)
  if (type && rowType && rowType === type) return true
  const slot = (query.slotKey ?? "").trim()
  const rowSlot = rowSlotKey(row)
  if (!slot || !rowSlot || slot !== rowSlot) return false
  if (slot === "roof") {
    return roofCoveringIdentity(query.itemType) === roofCoveringIdentity(row.appliance_type)
  }
  // Appliances can appear more than once on one report — type must also match.
  if (isSharedCatalogSlot(slot)) return false
  return true
}

/**
 * Reuse a unit_assets row only when this is the same photo finding or the same
 * identifiable piece of equipment. Do not collapse two inspection photos
 * into one catalog slot (e.g. two appliances, two HVAC units).
 *
 * One inspection report is stored as a single photo row with many findings.
 * `distinctFindingsPerPhoto` keeps each finding on its own asset.
 */
export function findReusableInspectionUnitAsset(
  buildingAssets: InspectionAssetMatchCandidate[],
  query: {
    photoId: string
    itemType: string
    brand: string | null
    model: string | null
    serial: string | null
    slotKey?: string | null
    distinctFindingsPerPhoto?: boolean
  },
): InspectionAssetMatchCandidate | null {
  const photoId = query.photoId.trim()
  if (photoId) {
    const samePhoto = buildingAssets.filter(
      (row) => String(meta(row).photoId ?? "") === photoId,
    )
    const sameFinding = samePhoto.find((row) => inspectionAssetMatchesFinding(row, query))
    if (sameFinding) return sameFinding
    if (!query.distinctFindingsPerPhoto && samePhoto.length === 1) {
      return samePhoto[0]!
    }
  }

  const serial = norm(query.serial)
  if (serial) {
    const bySerial = buildingAssets.find((row) => norm(String(meta(row).serialNumber ?? "")) === serial)
    if (bySerial) return bySerial
  }

  const type = norm(query.itemType)
  const brand = norm(query.brand)
  const model = norm(query.model)
  if (type && brand && model) {
    const byNameplate = buildingAssets.find((row) => {
      return (
        norm(row.appliance_type) === type &&
        norm(row.brand) === brand &&
        norm(row.model) === model
      )
    })
    if (byNameplate) return byNameplate
  }

  const slot = (query.slotKey ?? "").trim()
  if (slot === "roof") {
    const cover = roofCoveringIdentity(query.itemType)
    return (
      buildingAssets.find((row) => {
        return rowSlotKey(row) === "roof" &&
          roofCoveringIdentity(row.appliance_type) === cover
      }) ?? null
    )
  }

  return null
}
