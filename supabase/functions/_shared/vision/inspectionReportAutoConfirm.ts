import type { ApplianceVisionResult } from "./types.ts"

const PLACEHOLDER_ITEM_TYPE = /^(unknown( item| asset)?|inspection report)$/i

const TRACKED_SYSTEM_CATEGORIES = new Set([
  "electrical_panel",
  "hvac",
  "water_heater",
  "boiler",
  "roof",
  "plumbing",
])

/** True when a document extract item is safe to persist without a human review. */
export function inspectionReportItemEligibleForAutoConfirm(
  item: ApplianceVisionResult,
): boolean {
  const type = item.identifiedItem?.type?.trim() ?? ""
  if (!type || PLACEHOLDER_ITEM_TYPE.test(type)) return false
  const hasAge =
    item.estimatedAge?.value != null && Number.isFinite(item.estimatedAge.value)
  const hasBrand = Boolean(item.identifiedItem.brand?.trim())
  const confidence =
    typeof item.overallConfidence === "number" && Number.isFinite(item.overallConfidence)
      ? item.overallConfidence
      : null
  const rating = item.condition?.rating
  const hasReportedCondition =
    Boolean(item.condition?.summary?.trim()) ||
    rating === "good" ||
    rating === "poor" ||
    rating === "unsafe"
  // Prompted blank/illegible sections: keep the row for review, do not persist.
  if (confidence === 0 && !hasAge && !hasBrand) {
    if (TRACKED_SYSTEM_CATEGORIES.has(item.category) && hasReportedCondition) return true
    return false
  }
  return true
}
