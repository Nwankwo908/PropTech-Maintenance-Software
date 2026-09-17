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

  return {
    requested: true,
    reason: 'A photo helps the property team see the issue.',
  }
}
