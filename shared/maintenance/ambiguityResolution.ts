/**
 * Ambiguous maintenance → primary category + specific trade.
 * Description → category → diagnose overlap → trade → vendor match.
 * Do not import deterministicRules (avoid cycles); inferTradeFromText calls this first.
 */
import type {
  ClarificationPrompt,
  EmergencyType,
  IssueType,
  VendorTrade,
} from './classificationTypes.ts'
import {
  primaryCategoryFromTrade,
  type PrimaryCategory,
} from './primaryCategories.ts'

export type AmbiguityResolution = {
  /** True when this layer has an opinion (clarify, dual-trade, or override). */
  handled: boolean
  primaryCategory: PrimaryCategory
  primaryTrade: VendorTrade | null
  secondaryTrade: VendorTrade | null
  confidence: number
  reason: string
  needsClarification: boolean
  clarification: ClarificationPrompt | null
  emergency: EmergencyType
  issueType: IssueType | null
}

const NONE: AmbiguityResolution = {
  handled: false,
  primaryCategory: 'general',
  primaryTrade: null,
  secondaryTrade: null,
  confidence: 0,
  reason: '',
  needsClarification: false,
  clarification: null,
  emergency: 'none',
  issueType: null,
}

function haystack(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "'")
}

const FIXTURE_RE =
  /\b(sink|toilet|shower|bathtub|tub|faucet|tap|pipe|pipes|water\s*heater|hot\s*water\s*heater|supply\s*line|hose\s*bib)\b/i
const RAIN_RE = /\b(rain|raining|storm|when(?:ever)?\s+it\s+rains|after\s+(?:the\s+)?rain)\b/i
const ROOF_RE = /\b(roof|roofs|roofing|shingle|shingles)\b/i
const CEILING_RE = /\b(ceiling|ceilings)\b/i
const UNIT_ABOVE_RE =
  /\b((?:unit|apartment|apt|neighbor|bathroom|bath|toilet|shower|kitchen)\s+above|upstairs\s+(?:bath|bathroom|toilet|shower|unit|neighbor)|unit\s+directly\s+above)\b/i
const TOP_FLOOR_RE = /\b(top[- ]floor|top\s+story|highest\s+floor)\b/i
const FLOOD_RE =
  /\b(pouring|gushing|flooding|flooded|water\s+everywhere|burst(?:ing)?(?:\s+pipe)?|soaking)\b/i
const WATER_RE =
  /\b(water|leak|leaking|leaky|drip|dripping|wet|moisture)\b/i
const FURNACE_RE = /\b(furnace|boiler|water\s*heater)\b/i
const WATER_NEAR_FURNACE_RE =
  /\bwater\b.{0,40}\bfurnace\b|\bfurnace\b.{0,40}\bwater\b/i

const HYDRONIC_RE =
  /\b(radiator|radiators|boiler|hydronic|steam\s*heat|hot[- ]water\s*heat(?:ing)?|baseboard\s+heat(?:ing)?)\b/i
const FORCED_AIR_RE =
  /\b(furnace|heat\s*pump|forced\s*air|air\s*handler|central\s+(?:heat|air|hvac)|thermostat)\b/i
const HEAT_PROBLEM_RE =
  /\b(no\s*heat|no\s*heating|heat(?:ing)?\s+(?:is\s+)?(?:n'?t|not|isn'?t)\s+working|won'?t\s+heat|heat(?:ing)?\s+out|cold\s+(?:apartment|unit|radiator)|radiator(?:s)?\s+(?:is|are)\s+cold)\b/i
const BUILDING_WIDE_RE =
  /\b(whole\s+building|entire\s+building|all\s+units|every\s+(?:unit|apartment)|building[- ]wide)\b/i

const STAIRS_RE =
  /\b(stairs?|stairway|stairwell|handrail|hand\s*rail|railing|banister)\b/i
const DOOR_STRUCT_RE =
  /\b(broken\s+door|door\s+(?:won'?t|will\s+not|doesn'?t)\s+(?:close|open)|(?:won'?t|will\s+not)\s+(?:close|open).{0,12}door)\b/i
const FOUNDATION_RE =
  /\b(foundation|settling|structural\s+crack|crack(?:ing)?\s+(?:going\s+)?(?:up|upward|through).{0,20}wall|crack.{0,24}wall|wall.{0,24}crack)\b/i
const HOLE_IN_WALL_RE =
  /\bhole\s+in(?:\s+(?:the|my|a|\w+)){0,3}\s+wall\b/i
const SAGGING_RE = /\b(sagging\s+ceiling|ceiling\s+(?:is\s+)?sagging|ceiling\s+(?:dropping|bowing))\b/i
const WINDOW_STRUCT_RE = /\b(broken\s+window|window\s+(?:won'?t|will\s+not|doesn'?t)\s+(?:close|open|lock))\b/i

const PEST_RE =
  /\b(pest|roach(?:es)?|cockroach(?:es)?|mouse|mice|rat|rats|rodent(?:s)?|ant(?:s)?|spider(?:s)?|bug(?:s)?|insect(?:s)?|termite(?:s)?|bed\s*bugs?|infestation|droppings|(?:bug|insect|flea|bed\s*bug|spider)s?\s+bites)\b/i
const PEST_ENTRY_RE =
  /\b(inside\s+the\s+wall|in(?:side)?\s+(?:the\s+)?walls?|through\s+(?:a\s+)?(?:hole|opening|gap|crack)|damaged\s+wall)\b/i
const PEST_PLUMB_RE =
  /\b(under(?:neath)?\s+(?:(?:the|my|a)\s+)?(?:sink|dishwasher)|around\s+(?:(?:the|my|a)\s+)?(?:sink|leak|pipe)|leaking\s+sink)\b/i
const TERMITE_WOOD_RE =
  /\b(termite|joist|floor\s*joist|wood\s+damage|damaged\s+(?:floor|wood|beam))\b/i

function resolved(partial: Omit<AmbiguityResolution, 'handled'>): AmbiguityResolution {
  return { handled: true, ...partial }
}

function bestJudgment(
  trade: VendorTrade,
  extras: Partial<AmbiguityResolution> & { reason: string },
): AmbiguityResolution {
  return resolved({
    primaryCategory: extras.primaryCategory ?? primaryCategoryFromTrade(trade),
    primaryTrade: trade,
    secondaryTrade: extras.secondaryTrade ?? null,
    confidence: extras.confidence ?? 0.58,
    reason: extras.reason,
    needsClarification: false,
    clarification: null,
    emergency: extras.emergency ?? 'none',
    issueType: extras.issueType ?? null,
  })
}

function resolveWater(hay: string): AmbiguityResolution | null {
  if (!WATER_RE.test(hay) && !CEILING_RE.test(hay) && !ROOF_RE.test(hay)) return null

  const flood = FLOOD_RE.test(hay)
  const emergency: EmergencyType = flood ? 'flood' : 'none'
  const fixture = FIXTURE_RE.test(hay)
  const rain = RAIN_RE.test(hay)
  const roof = ROOF_RE.test(hay)
  const ceiling = CEILING_RE.test(hay)
  const unitAbove = UNIT_ABOVE_RE.test(hay)
  const topFloor = TOP_FLOOR_RE.test(hay)

  if (roof && (WATER_RE.test(hay) || rain) && !fixture) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'roofing',
      secondaryTrade: null,
      confidence: 0.9,
      reason: rain
        ? 'Roof/envelope leak associated with rain'
        : 'Resident named the roof as the leak source',
      needsClarification: false,
      clarification: null,
      emergency,
      issueType: 'roofing',
    })
  }

  if (fixture && !rain && !roof) {
    return resolved({
      primaryCategory: 'plumbing',
      primaryTrade: 'plumbing',
      secondaryTrade: null,
      confidence: 0.92,
      reason: 'Leak tied to a plumbing fixture, pipe, or water heater',
      needsClarification: false,
      clarification: null,
      emergency,
      issueType: flood ? 'leak' : 'plumbing',
    })
  }

  if (WATER_NEAR_FURNACE_RE.test(hay) && FURNACE_RE.test(hay)) {
    return bestJudgment('plumbing', {
      primaryCategory: 'plumbing',
      confidence: 0.58,
      reason: 'Water near a furnace — best judgment plumbing (pipes) rather than HVAC',
      emergency,
      issueType: 'leak',
    })
  }

  if (ceiling && WATER_RE.test(hay)) {
    if (rain) {
      return resolved({
        primaryCategory: 'structural',
        primaryTrade: 'roofing',
        secondaryTrade: null,
        confidence: 0.88,
        reason: 'Ceiling leak during or after rain points to the roof or building envelope',
        needsClarification: false,
        clarification: null,
        emergency,
        issueType: 'roofing',
      })
    }
    if (unitAbove) {
      return resolved({
        primaryCategory: 'plumbing',
        primaryTrade: 'plumbing',
        secondaryTrade: null,
        confidence: 0.84,
        reason: 'Ceiling leak with a unit or plumbing fixture above is likely a pipe or fixture above',
        needsClarification: false,
        clarification: null,
        emergency,
        issueType: 'leak',
      })
    }
    if (topFloor && !fixture) {
      return bestJudgment('roofing', {
        primaryCategory: 'structural',
        confidence: 0.58,
        reason: 'Top-floor ceiling leak — best judgment roofing until rain or a fixture is named',
        emergency,
        issueType: 'roofing',
      })
    }
    if (!fixture && !roof) {
      return bestJudgment('plumbing', {
        primaryCategory: 'plumbing',
        confidence: 0.58,
        reason: 'Indoor ceiling leak — best judgment plumbing until rain or a fixture is named',
        emergency,
        issueType: 'leak',
      })
    }
  }

  return null
}

function resolveHeat(hay: string): AmbiguityResolution | null {
  const hydronic = HYDRONIC_RE.test(hay)
  const forcedAir = FORCED_AIR_RE.test(hay)
  const heatProblem =
    HEAT_PROBLEM_RE.test(hay) ||
    (/\bheat(?:ing)?\b/i.test(hay) &&
      /\b(not|n'?t|no|cold|broken|out|isn'?t|doesn'?t)\b/i.test(hay))
  const buildingWide = BUILDING_WIDE_RE.test(hay)

  if (!hydronic && !heatProblem && !/\bno\s*heat\b/i.test(hay)) return null
  if (
    /\b(ac|air\s*condition|cooling|won'?t\s+cool)\b/i.test(hay) &&
    !hydronic &&
    !/\bheat\b/i.test(hay)
  ) {
    return null
  }

  if (hydronic && !forcedAir) {
    return resolved({
      primaryCategory: 'hvac',
      primaryTrade: 'plumbing',
      secondaryTrade: null,
      confidence: 0.9,
      reason: buildingWide
        ? 'Hydronic or boiler heat — plumbing/boiler trade; may be building-level equipment'
        : 'Radiator, boiler, or hydronic heat is a plumbing/boiler trade, not forced-air HVAC',
      needsClarification: false,
      clarification: null,
      emergency: /\bno\s*heat\b|freezing/i.test(hay) ? 'habitability' : 'none',
      issueType: 'hvac',
    })
  }

  if (forcedAir && (heatProblem || /\bno\s*heat\b/i.test(hay))) {
    return resolved({
      primaryCategory: 'hvac',
      primaryTrade: 'hvac',
      secondaryTrade: null,
      confidence: 0.9,
      reason: 'Furnace, heat pump, or forced-air heating',
      needsClarification: false,
      clarification: null,
      emergency: /\bno\s*heat\b|freezing/i.test(hay) ? 'habitability' : 'none',
      issueType: 'hvac',
    })
  }

  if (heatProblem || /\bno\s*heat\b/i.test(hay)) {
    return bestJudgment('hvac', {
      primaryCategory: 'hvac',
      confidence: 0.58,
      reason: buildingWide
        ? 'No heat — best judgment HVAC until the heating system or building scope is named'
        : 'No heat — best judgment HVAC until the heating system is named',
      emergency: 'habitability',
      issueType: 'hvac',
    })
  }

  return null
}

function resolveStructural(hay: string): AmbiguityResolution | null {
  if (SAGGING_RE.test(hay) && !WATER_RE.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'carpentry',
      secondaryTrade: 'general',
      confidence: 0.78,
      reason:
        'Sagging ceiling is structural; carpentry/general contractor, not a plumbing dispatch by default',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'general',
    })
  }

  if (FOUNDATION_RE.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'masonry',
      secondaryTrade: null,
      confidence: 0.82,
      reason: 'Wall or foundation cracking — masonry / foundation specialty',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'general',
    })
  }

  if (HOLE_IN_WALL_RE.test(hay) && !WATER_RE.test(hay) && !PEST_RE.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'carpentry',
      secondaryTrade: null,
      confidence: 0.84,
      reason: 'Hole in a wall — carpentry, not a plumbing or pest dispatch by the location word alone',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'general',
    })
  }

  if ((STAIRS_RE.test(hay) || DOOR_STRUCT_RE.test(hay)) && !/\bdeck\b/i.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'carpentry',
      secondaryTrade: 'general',
      confidence: 0.86,
      reason: 'Stairs, railing, or door hardware — carpenter or general contractor',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'general',
    })
  }

  if (WINDOW_STRUCT_RE.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'windows',
      secondaryTrade: null,
      confidence: 0.86,
      reason: 'Window damage — window trade',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'general',
    })
  }

  if (ROOF_RE.test(hay) && /\b(damage|hole|missing\s+shingle|caved)\b/i.test(hay) && !WATER_RE.test(hay)) {
    return resolved({
      primaryCategory: 'structural',
      primaryTrade: 'roofing',
      secondaryTrade: null,
      confidence: 0.88,
      reason: 'Roof damage without a named plumbing fixture',
      needsClarification: false,
      clarification: null,
      emergency: 'none',
      issueType: 'roofing',
    })
  }

  return null
}

function resolvePest(hay: string): AmbiguityResolution | null {
  if (!PEST_RE.test(hay)) return null

  let secondary: VendorTrade | null = null
  let reason = 'Pest sighting or infestation — pest control'
  if (TERMITE_WOOD_RE.test(hay) && /\b(termite|joist|wood)\b/i.test(hay)) {
    secondary = 'carpentry'
    reason = 'Termites or wood damage — pest control first, carpentry follow-up likely'
  } else if (PEST_ENTRY_RE.test(hay)) {
    secondary = 'carpentry'
    reason = 'Pests in a wall or opening — pest control, with possible carpentry to seal entry'
  } else if (PEST_PLUMB_RE.test(hay)) {
    secondary = 'plumbing'
    reason = 'Pests near a sink or dishwasher — pest control, and check for a plumbing leak'
  }

  return resolved({
    primaryCategory: 'pest',
    primaryTrade: 'pest_control',
    secondaryTrade: secondary,
    confidence: 0.9,
    reason,
    needsClarification: false,
    clarification: null,
    emergency: 'none',
    issueType: 'pest',
  })
}

/**
 * Diagnose overlapping categories. Returns handled:false when existing keyword rules should apply.
 */
export function resolveAmbiguousMaintenance(text: string): AmbiguityResolution {
  const hay = haystack(text)
  if (!hay.trim()) return NONE

  const water = resolveWater(hay)
  if (water) return water

  const heat = resolveHeat(hay)
  if (heat) return heat

  const pest = resolvePest(hay)
  if (pest) return pest

  const structural = resolveStructural(hay)
  if (structural) return structural

  return NONE
}

export function attachPrimaryCategory(
  trade: VendorTrade,
  resolvedHit: AmbiguityResolution | null,
): PrimaryCategory {
  if (resolvedHit?.handled) return resolvedHit.primaryCategory
  return primaryCategoryFromTrade(trade)
}
