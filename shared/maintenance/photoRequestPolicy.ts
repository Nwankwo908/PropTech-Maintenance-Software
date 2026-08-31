/**
 * Whether intake should ask the resident for a photo.
 * Matching still uses trade; this only gates the SMS/web photo step.
 */
import type { EmergencyType } from './classificationTypes.ts'
import type { PrimaryCategory } from './primaryCategories.ts'

export type PhotoRequestInput = {
  text: string
  primaryCategory?: PrimaryCategory | null
  vendorTrade?: string | null
  emergencyType?: EmergencyType | string | null
  issueType?: string | null
  hasPhotoAlready?: boolean
}

export type PhotoRequestResult = {
  requested: boolean
  reason: string
}

function haystack(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "'")
}

function categoryOf(input: PhotoRequestInput): string {
  return (input.primaryCategory ?? input.vendorTrade ?? input.issueType ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

export function resolvePhotoRequest(input: PhotoRequestInput): PhotoRequestResult {
  if (input.hasPhotoAlready) {
    return { requested: false, reason: 'A photo is already attached.' }
  }

  const hay = haystack(input.text)
  const cat = categoryOf(input)
  const emergency = String(input.emergencyType ?? '').toLowerCase()

  const electrical =
    cat === 'electrical' ||
    emergency === 'electrical' ||
    /\b(spark|sparks|sparking|exposed\s+wire|breaker\s+panel)\b/.test(hay)
  if (electrical || emergency === 'gas' || emergency === 'fire') {
    return {
      requested: false,
      reason: 'Do not ask the resident to photograph electrical, gas, or fire hazards.',
    }
  }

  const drippingFaucet =
    /\b(drip(?:ping)?\s+faucet|faucet\s+(?:is\s+)?drip(?:ping)?|leaky\s+faucet)\b/.test(hay) &&
    !/\b(damage|flood|soaking|gushing|overflow|active\s+leak)\b/.test(hay)
  if (drippingFaucet) {
    return { requested: false, reason: 'A dripping faucet does not need a photo.' }
  }

  if (
    /\b(water\s+damage|active\s+leak|flood(?:ing|ed)?|gushing|pouring|soaking|wet\s+(?:floor|ceiling|carpet|wall)|overflow)\b/.test(
      hay,
    )
  ) {
    return { requested: true, reason: 'Water damage or an active leak — a photo changes urgency.' }
  }

  if (
    /\b(crack(?:s|ed)?|hole(?:s)?\s+in\s+(?:the\s+)?(?:wall|ceiling|floor)|sagging|sinking|structural)\b/.test(
      hay,
    )
  ) {
    return { requested: true, reason: 'Structural damage is easier to assess with a photo.' }
  }

  const appliance =
    cat === 'appliance' ||
    cat === 'appliance_repair' ||
    /\b(fridge|refrigerator|freezer|stove|oven|dishwasher|washer|dryer|washing\s+machine|microwave)\b/.test(
      hay,
    )
  if (appliance && /\b(not\s+working|isn'?t\s+working|broken|won'?t|not\s+cold|warm)\b/.test(hay)) {
    return { requested: true, reason: 'An appliance malfunction is easier to assess with a photo.' }
  }
  if (cat === 'appliance' || cat === 'appliance_repair') {
    return { requested: true, reason: 'An appliance issue is easier to assess with a photo.' }
  }

  const pest =
    cat === 'pest' ||
    cat === 'pest_control' ||
    /\b(pest|roach|cockroach|mouse|mice|rat|ant|spider|bug|insect|termite)\b/.test(hay)
  if (pest) {
    return { requested: true, reason: 'A pest sighting is easier to confirm with a photo.' }
  }

  if (cat === 'structural' || cat === 'roofing' || cat === 'carpentry' || cat === 'masonry') {
    return { requested: true, reason: 'Structural issues are easier to assess with a photo.' }
  }

  const hvac =
    cat === 'hvac' ||
    /\b(no\s*heat|no\s*heating|ac\s+not|air\s*condition|thermostat|furnace|won'?t\s+cool|won'?t\s+heat)\b/.test(
      hay,
    )
  if (hvac) {
    return { requested: false, reason: 'HVAC issues are rarely clearer from a photo.' }
  }

  return { requested: false, reason: 'A photo is not needed for this issue.' }
}
