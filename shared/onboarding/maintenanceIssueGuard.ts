/**
 * Guards onboarding maintenance extraction so listing/property photos
 * do not become fake work orders from visible rooms/finishes/appliances.
 */

const DEFECT_SIGNAL =
  /\b(leak|leaking|broken|crack(?:ed|ing)?|damag(?:e|ed)|repair|clog(?:ged)?|mold|mildew|rot(?:ting)?|flood|spark(?:ing)?|odor|smell|stain(?:ed|ing)?|peeling|hole|missing|replace|fix|not\s+working|doesn'?t\s+work|won'?t\s+work|out\s+of\s+order|water\s+damage|needs?\s+(?:repair|fix|replace)|issue|problem|defect|faulty)\b/i

/** Exact labels we saw extracted from listing photos (amenities, not repairs). */
const FEATURE_LABELS = new Set([
  'window',
  'windows',
  'carpet',
  'wooden floor',
  'wood flooring',
  'hardwood floor',
  'hardwood flooring',
  'living room',
  'dining room',
  'bedroom',
  'bathroom',
  'kitchen',
  'empty room',
  'room',
  'sink',
  'countertop',
  'countertops',
  'stainless steel appliances',
  'curtains',
  'dishwasher',
  'microwave',
  'oven',
  'stove',
  'refrigerator',
  'fridge',
  'toilet',
  'artwork',
  'mantel',
  'fireplace',
  'baseboard',
  'baseboards',
  'baseboard heater',
  'tiles',
  'tile',
  'chandelier',
  'backsplash',
  'punchlist',
  'punch list',
  'closet',
  'hallway',
  'stairs',
  'balcony',
  'deck',
  'patio',
  'garage',
  'basement',
  'attic',
  'ceiling fan',
  'light fixture',
  'cabinets',
  'vanity',
  'shower',
  'bathtub',
  'tub',
])

function normalizeIssueDescription(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * True when the text looks like a room/finish/appliance label from a listing
 * photo, not a real repair problem.
 */
export function looksLikePropertyFeatureNotRepair(description: string): boolean {
  const d = normalizeIssueDescription(description)
  if (!d) return true
  if (DEFECT_SIGNAL.test(d)) return false
  if (FEATURE_LABELS.has(d)) return true

  // Short noun phrases without defect language (e.g. "wood flooring", "empty room").
  const words = d.split(' ').filter(Boolean)
  if (words.length <= 4 && /^[a-z0-9][a-z0-9\s\-\/]*$/i.test(d)) {
    if (
      /^(?:empty|living|dining|bed|bath|guest|master)?\s*(?:room|kitchen|bath(?:room)?|closet|hallway|basement|attic|garage|porch|deck|balcony)$/i
        .test(d)
    ) {
      return true
    }
    if (
      /^(?:hardwood|wood|wooden|tile|carpet|vinyl|laminate)?\s*(?:floor|flooring|carpet)$/i
        .test(d)
    ) {
      return true
    }
    if (
      /^(?:stainless\s+steel\s+)?(?:appliances?|refrigerator|fridge|dishwasher|microwave|oven|stove|range)$/i
        .test(d)
    ) {
      return true
    }
  }

  return false
}

/**
 * Only auto-check an extracted maintenance row when it looks like a real repair
 * and the model is reasonably confident.
 *
 * Even when selected, Fast Track imports these into Property Maintenance History
 * only — they do not become Open Repairs / Active Tasks.
 */
export function shouldAutoSelectMaintenanceIssue(input: {
  description: string
  confidence?: number | null
}): boolean {
  const description = input.description?.trim() ?? ''
  if (!description) return false
  if (looksLikePropertyFeatureNotRepair(description)) return false
  const confidence = Number(input.confidence)
  if (Number.isFinite(confidence) && confidence < 75) return false
  return true
}

export function isLikelyPropertyPhotoFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase()
  if (!/\.(jpg|jpeg|png|heic|webp|tif|tiff)$/i.test(lower)) return false
  // Explicit inspection / punchlist names stay inspection-like.
  if (/inspection|walkthrough|punch\s*list|repair|damage|defect/i.test(lower)) return false
  return true
}
