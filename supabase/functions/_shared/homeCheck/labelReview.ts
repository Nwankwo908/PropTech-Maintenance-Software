type Asset = { id: string; metadata: Record<string, any> }
export type HomeCheckLabelCorrection = { assetId: string; modelNumber?: string | null; serialNumber?: string | null; manufactureYear?: number | null; manufactureMonth?: number | null }

/** SMS OK accepts disclosed unknowns; it must never select an OCR candidate. */
export function smsUnknownLabelCorrections(assets: Asset[]): HomeCheckLabelCorrection[] {
  return assets.flatMap(asset => {
    const meta = asset.metadata
    const quality = meta.homeCheck?.labelReadability
    if (!quality?.retakeRequested || meta.labelReviewAcknowledged || meta.landlordLabelVerified) return []
    const correction: HomeCheckLabelCorrection = { assetId: asset.id }
    for (const [field, key] of [['model', 'modelNumber'], ['serial', 'serialNumber']] as const) {
      const value = meta.homeCheck?.fields?.[field]?.value
      if (value == null || value === '') correction[key] = null
      else if (!(quality[`${field}Confidence`] >= 85)) throw new Error('Review the flagged label in Property Intelligence before confirming.')
    }
    if (Object.keys(correction).length === 1) throw new Error('Review the flagged label in Property Intelligence before confirming.')
    return [correction]
  })
}
