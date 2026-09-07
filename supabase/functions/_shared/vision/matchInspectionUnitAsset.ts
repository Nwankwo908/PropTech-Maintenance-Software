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

/**
 * Reuse a unit_assets row only when this is the same photo or the same
 * identifiable piece of equipment. Do not collapse two inspection photos
 * into one catalog slot (e.g. two appliances, two HVAC units).
 */
export function findReusableInspectionUnitAsset(
  buildingAssets: InspectionAssetMatchCandidate[],
  query: {
    photoId: string
    itemType: string
    brand: string | null
    model: string | null
    serial: string | null
  },
): InspectionAssetMatchCandidate | null {
  const photoId = query.photoId.trim()
  if (photoId) {
    const byPhoto = buildingAssets.find((row) => String(meta(row).photoId ?? "") === photoId)
    if (byPhoto) return byPhoto
  }

  const serial = norm(query.serial)
  if (serial) {
    const bySerial = buildingAssets.find((row) => norm(String(meta(row).serialNumber ?? "")) === serial)
    if (bySerial) return bySerial
  }

  const type = norm(query.itemType)
  const brand = norm(query.brand)
  const model = norm(query.model)
  if (!type || !brand || !model) return null

  return (
    buildingAssets.find((row) => {
      return (
        norm(row.appliance_type) === type &&
        norm(row.brand) === brand &&
        norm(row.model) === model
      )
    }) ?? null
  )
}
