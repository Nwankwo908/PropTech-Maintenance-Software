/**
 * Resident-facing urgency: emergency (same-day) / medium (48h) / low (7 days).
 * Vendor matching still uses trade; this only sets response window + severity.
 */
import type { EmergencyType, SeverityLevel } from './classificationTypes.ts'

export const URGENCY_BANDS = ['emergency', 'medium', 'low'] as const
export type UrgencyBand = (typeof URGENCY_BANDS)[number]

/** Minutes from create → due_at. Life-safety emergencies stay faster than generic same-day. */
export const URGENCY_SLA_MINUTES = {
  emergencyLifeSafety: 60,
  emergencyWater: 120,
  emergencySameDay: 480,
  medium: 2880,
  low: 10080,
} as const

export type UrgencyPolicyInput = {
  text: string
  outdoorTempF?: number | null
  durationHours?: number | null
  emergencyType?: EmergencyType | null
}

export type UrgencyPolicyResult = {
  band: UrgencyBand
  reason: string
  severity: SeverityLevel
  /** SMS confirm vocabulary */
  smsUrgency: 'emergency' | 'normal' | 'low'
  slaMinutes: number
  leaveImmediately: boolean
}

function haystack(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "'")
}

const NO_HEAT_RE =
  /\b(no\s*heat|no\s*heating|heat(?:ing)?\s+(?:is\s+)?(?:n'?t|not|isn'?t)\s+working|won'?t\s+heat)\b/
const NO_COOLING_RE =
  /\b(no\s+cool(?:ing)?|ac\s+(?:not|isn'?t|n'?t)\s+working|air\s*condition(?:er|ing)?\s+(?:not|isn'?t)|won'?t\s+cool|blowing\s+warm)\b/

/** Heat / cooling bands need outdoor °F. Other issues do not. */
export function descriptionNeedsOutdoorTemp(text: string): boolean {
  const hay = haystack(text)
  return NO_HEAT_RE.test(hay) || NO_COOLING_RE.test(hay)
}

export function parseDurationHours(text: string): number | null {
  const hay = haystack(text)
  const hours = hay.match(/\b(?:for|after|over|more\s+than)\s+(\d+)\s+hours?\b/)
  if (hours) return Number(hours[1])
  const days = hay.match(/\b(?:for|after|over|more\s+than|since)\s+(\d+)\s+days?\b/)
  if (days) return Number(days[1]) * 24
  if (/\b(more\s+than|over|past)\s+(a\s+|one\s+)?(day|24\s*hours?)\b/.test(hay)) return 24
  if (/\b(two|2)\s+days?\b/.test(hay)) return 48
  if (/\bsince\s+yesterday\b/.test(hay)) return 24
  if (/\blast\s+night\b/.test(hay)) return 12
  if (/\ball\s+day\b/.test(hay)) return 12
  if (/\bthis\s+morning\b/.test(hay)) return 6
  if (/\byesterday\b/.test(hay) && /\bno\s+hot\s+water\b/.test(hay)) return 24
  return null
}

function slaForEmergency(emergencyType: EmergencyType | null | undefined, hay: string): number {
  if (
    emergencyType === 'gas' ||
    emergencyType === 'fire' ||
    emergencyType === 'electrical' ||
    /\b(spark|sparks|sparking|smoking|smoke)\b/.test(hay)
  ) {
    return URGENCY_SLA_MINUTES.emergencyLifeSafety
  }
  if (
    emergencyType === 'flood' ||
    /\b(sewage|sewer\s+backup|flooding|gushing|pouring)\b/.test(hay)
  ) {
    return URGENCY_SLA_MINUTES.emergencyWater
  }
  return URGENCY_SLA_MINUTES.emergencySameDay
}

function result(
  band: UrgencyBand,
  reason: string,
  hay: string,
  emergencyType: EmergencyType | null | undefined,
  extras?: { leaveImmediately?: boolean },
): UrgencyPolicyResult {
  const slaMinutes =
    band === 'low'
      ? URGENCY_SLA_MINUTES.low
      : band === 'medium'
        ? URGENCY_SLA_MINUTES.medium
        : slaForEmergency(emergencyType ?? null, hay)
  return {
    band,
    reason,
    severity: band === 'emergency' ? (slaMinutes <= 120 ? 'critical' : 'urgent') : band === 'low' ? 'low' : 'normal',
    smsUrgency: band === 'emergency' ? 'emergency' : band === 'low' ? 'low' : 'normal',
    slaMinutes,
    leaveImmediately: extras?.leaveImmediately === true,
  }
}

/**
 * Policy table. First matching emergency wins, then medium, then low, else medium.
 */
export function resolveUrgencyPolicy(input: UrgencyPolicyInput): UrgencyPolicyResult {
  const hay = haystack(input.text)
  const durationHours = input.durationHours ?? parseDurationHours(input.text)
  const temp = input.outdoorTempF
  const emergencyType = input.emergencyType ?? 'none'

  if (
    /\b(gas\s*smell|smell\s*(?:of\s*)?gas|gas\s*leak|natural\s*gas|carbon\s+monoxide|co\s+alarm|rotten\s+eggs?|smells?\s+like\s+(?:rotten\s+)?(?:eggs?|sulfur)|sulfur\s+smell)\b/.test(hay) ||
    emergencyType === 'gas'
  ) {
    return result(
      'emergency',
      'Gas smell — leave the unit immediately and call the gas utility from outside if you have not already.',
      hay,
      'gas',
      { leaveImmediately: true },
    )
  }

  if (
    emergencyType === 'fire' ||
    /\b(on fire|house fire|unit (?:is )?on fire)\b/.test(hay)
  ) {
    return result(
      'emergency',
      'Fire is an emergency — leave immediately if it is not safe to stay.',
      hay,
      'fire',
      { leaveImmediately: true },
    )
  }

  if (
    (/\b(sparking|sparks?|smoking)\b/.test(hay) &&
      /\b(outlet|panel|breaker|electrical)\b/.test(hay)) ||
    (/\bspark/.test(hay) && /\b(outlet|panel|wire|electrical)\b/.test(hay)) ||
    (/\bsmok(?:e|ing)\b/.test(hay) && /\b(outlet|panel|electrical)\b/.test(hay))
  ) {
    return result('emergency', 'Sparking or smoking electrical equipment needs same-day response.', hay, 'electrical')
  }

  if (emergencyType === 'flood' || /\b(flooding|flooded|gushing|pouring|water\s+everywhere|burst(?:ing)?(?:\s+pipe)?)\b/.test(hay)) {
    return result('emergency', 'Flooding or an active uncontrolled leak needs same-day response.', hay, 'flood')
  }

  if (/\boverflow(?:ing)?\b/.test(hay) && /\b(toilet|tub|bathtub|sink)\b/.test(hay)) {
    return result('emergency', 'An overflowing fixture needs same-day response.', hay, 'flood')
  }

  if (/\b(sewage|sewer)\b/.test(hay) && /\b(backup|back\s*up|overflow|coming\s+up|backed\s+up)\b/.test(hay)) {
    return result('emergency', 'Sewage backup is an emergency.', hay, 'flood')
  }

  if (
    /\b(active\s+leak|leaking\s+(?:onto|through|into)|visible\s+damage|soaking|wet\s+(?:floor|ceiling|carpet|wall)|water\s+damage|spreading\s+(?:stain|damage))\b/.test(
      hay,
    )
  ) {
    return result('emergency', 'Active water leak with visible damage needs same-day response.', hay, 'flood')
  }

  if (/\bleak/.test(hay) && /\b(really\s+bad(?:ly)?|badly|a lot of water)\b/.test(hay) && !/\b(drip|faucet|minor|slow leak)\b/.test(hay)) {
    return result('emergency', 'An active leak that is getting worse needs same-day response.', hay, 'flood')
  }

  if (
    /\b(ceiling|from\s+(?:the\s+)?(?:roof|ceiling))\b/.test(hay) &&
    /\bleak/.test(hay) &&
    !/\b(drip(?:ping)?\s+faucet|minor\s+leak|slow\s+leak)\b/.test(hay)
  ) {
    return result('emergency', 'Water coming through a ceiling needs same-day response.', hay, 'flood')
  }

  const noPowerUnit =
    /\b(no\s+(?:power|electricity)|power\s+(?:is\s+)?out|entire\s+unit\s+(?:has\s+)?no\s+power)\b/.test(hay) &&
    /\b(entire\s+unit|whole\s+(?:unit|apartment|place)|everywhere\s+in\s+(?:the|my)\s+(?:unit|apartment)|all\s+(?:the\s+)?lights\s+(?:are\s+)?out)\b/.test(
      hay,
    )
  if (noPowerUnit || /\bno\s+power\s+to\s+(?:the\s+)?(?:entire|whole)\s+unit\b/.test(hay)) {
    return result('emergency', 'No power to the entire unit needs same-day response.', hay, 'electrical')
  }

  const exteriorLock =
    /\b(lock|deadbolt)\b/.test(hay) &&
    /\b(broken|won'?t\s+lock|cannot\s+lock|can'?t\s+lock|security)\b/.test(hay) &&
    /\b(exterior|outside|front\s+door|entry\s+door|building\s+door|entrance)\b/.test(hay)
  const lockout = /\blocked\s*out\b/.test(hay)
  if (exteriorLock || (lockout && /\b(front|exterior|entrance|building)\b/.test(hay))) {
    return result('emergency', 'A broken exterior lock is a security emergency.', hay, 'lockout')
  }

  const noHeat = NO_HEAT_RE.test(hay)
  const freezingText = /\b(freezing|below\s+freezing|below\s+32|ice\s+inside)\b/.test(hay)
  if (noHeat) {
    if (temp != null && temp < 55) {
      return result('emergency', 'No heat while outdoor temperature is below 55°F.', hay, 'habitability')
    }
    if (freezingText) {
      return result('emergency', 'No heat in freezing conditions.', hay, 'habitability')
    }
    if (temp != null && temp >= 55) {
      return result('medium', 'No heat while outdoor temperature is 55°F or above — respond within 48 hours.', hay, 'none')
    }
    return result('emergency', 'No heat — treat as same-day until outdoor temperature is known to be 55°F or above.', hay, 'habitability')
  }

  const noHotWater = /\b(no\s+hot\s+water|out\s+of\s+hot\s+water|hot\s+water\s+(?:is\s+)?(?:out|gone|not\s+working))\b/.test(hay)
  if (noHotWater) {
    if (durationHours != null && durationHours >= 24) {
      return result('emergency', 'No hot water for more than 24 hours.', hay, 'habitability')
    }
    return result('medium', 'No hot water for less than 24 hours — respond within 48 hours.', hay, 'none')
  }

  const noCooling = NO_COOLING_RE.test(hay)
  if (noCooling) {
    if (temp != null && temp >= 85) {
      return result('emergency', 'No cooling while outdoor temperature is 85°F or above.', hay, 'habitability')
    }
    return result('medium', 'No cooling while outdoor temperature is below 85°F — respond within 48 hours.', hay, 'none')
  }

  if (
    /\b(drip(?:ping)?\s+faucet|faucet\s+(?:is\s+)?drip(?:ping)?|leaky\s+faucet|slow\s+drain)\b/.test(hay) &&
    !/\b(fully\s+clogged|won'?t\s+drain|not\s+draining|backed\s+up)\b/.test(hay)
  ) {
    if (/\bslow\s+drain\b/.test(hay) && !/\b(fully\s+clogged|won'?t\s+drain)\b/.test(hay) && !/\bfaucet\b/.test(hay)) {
      return result('low', 'Slow drain that is not fully clogged can be scheduled within 7 days.', hay, 'none')
    }
    return result('medium', 'Dripping faucet or similar minor plumbing — respond within 48 hours.', hay, 'none')
  }

  if (/\b(fully\s+clogged|won'?t\s+drain|not\s+draining|clogged\s+drain)\b/.test(hay)) {
    return result('medium', 'A clogged drain needs a response within 48 hours.', hay, 'none')
  }

  if (
    /\b(outlet\s+(?:is\s+)?(?:not|isn'?t|n'?t)\s+working|dead\s+outlet|no\s+power\s+(?:at|to)\s+(?:the\s+)?outlet)\b/.test(hay) &&
    !/\bspark/.test(hay)
  ) {
    return result('medium', 'A non-sparking dead outlet — respond within 48 hours.', hay, 'none')
  }

  if (/\blights?\s+flicker/.test(hay)) {
    return result('medium', 'Flickering lights — respond within 48 hours.', hay, 'none')
  }

  if (
    /\b(interior\s+door|bedroom\s+door|closet\s+door|bathroom\s+door)\b/.test(hay) &&
    /\b(won'?t\s+close|not\s+closing|doesn'?t\s+close)\b/.test(hay)
  ) {
    return result('medium', 'Interior door not closing properly — respond within 48 hours.', hay, 'none')
  }

  if (
    /\b(minor\s+leak|small\s+leak|slow\s+leak)\b/.test(hay) &&
    !/\b(damage|flood|soaking|gushing)\b/.test(hay)
  ) {
    return result('medium', 'Minor leak without visible damage — respond within 48 hours.', hay, 'none')
  }

  const namedAppliance =
    /\b(fridge|refrigerator|freezer|stove|oven|dishwasher|washer|dryer|washing\s+machine|microwave)\b/.test(hay)
  if (namedAppliance && /\b(not\s+working|isn'?t\s+working|broken|won'?t\s+(?:turn|start|run))\b/.test(hay)) {
    return result('medium', 'Appliance not working (non-emergency) — respond within 48 hours.', hay, 'none')
  }
  if (/\b(fridge|refrigerator|freezer)\b/.test(hay) && /\b(not\s+cold|warm|not\s+cooling)\b/.test(hay)) {
    return result('medium', 'Refrigerator or freezer not cooling — respond within 48 hours.', hay, 'none')
  }

  if (/\b(light\s+bulb|bulb\s+(?:is\s+)?out|burned[- ]out\s+bulb)\b/.test(hay)) {
    return result('low', 'A light bulb out can be scheduled within 7 days.', hay, 'none')
  }

  if (/\b(scuff|paint\s+chip|cosmetic|scratch(?:es)?\s+on\s+(?:the\s+)?wall)\b/.test(hay)) {
    return result('low', 'Cosmetic issue — schedule within 7 days.', hay, 'none')
  }

  if (
    /\b(window|door)\b/.test(hay) &&
    /\b(adjust|sticky|hard\s+to\s+(?:open|close)|minor)\b/.test(hay) &&
    !/\b(broken|lock|exterior|front\s+door)\b/.test(hay)
  ) {
    return result('low', 'Minor door or window adjustment — schedule within 7 days.', hay, 'none')
  }

  const pest = /\b(pest|roach|cockroach|mouse|mice|rat|ant|spider|bug|insect|termite)\b/.test(hay)
  if (pest) {
    if (/\b(infestation|everywhere|swarm|nest|droppings\s+everywhere|multiple)\b/.test(hay)) {
      return result('medium', 'Pest infestation — respond within 48 hours.', hay, 'none')
    }
    return result('low', 'A single pest sighting can be scheduled within 7 days.', hay, 'none')
  }

  if (emergencyType !== 'none' && emergencyType !== 'habitability') {
    return result('emergency', 'Safety signal requires same-day response.', hay, emergencyType)
  }

  return result('medium', 'No emergency or low-priority signal — default to a 48-hour response.', hay, 'none')
}

export function urgencyBandFromSeverity(severity: string | null | undefined): UrgencyBand {
  const s = (severity ?? '').toLowerCase()
  if (s === 'low') return 'low'
  if (s === 'urgent' || s === 'emergency' || s === 'critical' || s === 'high') return 'emergency'
  return 'medium'
}
