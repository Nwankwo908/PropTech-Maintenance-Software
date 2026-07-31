/**
 * Deterministic trade / issue / safety rules — shared source of truth for keyword signals.
 */
import type {
  EmergencyType,
  IssueType,
  SeverityLevel,
  VendorTrade,
} from './classificationTypes.ts'

export type RuleHit = {
  trade: VendorTrade
  issueType: IssueType
  keywords: string[]
  severityBoost: SeverityLevel | null
  emergency: EmergencyType
  weight: number
}

const PLUMBING_RE =
  /\b(leak|leaking|leaky|drip|dripping|faucet|tap|sink|basin|toilet|pipe|pipes|drain|clog|clogged|overflow|overflowing|flood|flooding|flooded|water\s*damage|sewage|sewer|plumber|plumbing|hose\s*bib|water\s*heater|supply\s*line)\b/i

const ELECTRICAL_RE =
  /\b(electric|electrical|outlet|outlets|breaker|wiring|wire|wires|spark|sparks|sparking|power|no\s*power|light(?:s)?|gfci|panel|short\s*circuit|burning\s*smell)\b/i

const HVAC_RE =
  /\b(hvac|heat|heating|no\s*heat|furnace|thermostat|air\s*condition(?:ing|er)?|\bac\b|cool(?:ing)?|blowing\s*warm|won'?t\s*cool|too\s*hot|too\s*cold)\b/i

const APPLIANCE_RE =
  /\b(fridge|refrigerator|freezer|washer|dryer|oven|stove|dishwasher|microwave|appliance|not\s*cold|warm\s*inside)\b/i

const LOCK_RE =
  /\b(lock(?:ed|smith)?|key|keys|deadbolt|locked\s*out|can'?t\s*get\s*in|cannot\s*get\s*in|door\s*stuck|lockout)\b/i

const PEST_RE =
  /\b(pest|roach(?:es)?|mouse|mice|rat|rats|rodent(?:s)?|vermin|bug|bugs|insect|termite|infestation|bee|bees|wasp|hornet|hive|exterminator|extermination|creatures?\s+in\s+(?:my\s+)?(?:apartment|unit|home|kitchen))\b/i

const APPLIANCE_AS_LOCATION_RE =
  /\b(?:behind|under|near|from\s+(?:behind|under)|around)\s+(?:the\s+)?(?:stove|oven|fridge|refrigerator|dishwasher|washer|dryer|freezer)\b/i

const DOOR_HARDWARE_RE =
  /\b(door\s*(?:piece|part|handle|knob|hinge|frame)|piece\s+for\s+(?:the\s+)?door|broken\s+door)\b/i

const STAIRS_ENTRANCE_RE =
  /\b(?:stairs?|stairway|stairwell|stepping|handrail|hand\s*rail|railing|banister|nosing|front\s*(?:step|steps|entrance|entry)|entrance\s*steps?|entry\s*steps?|leading\s+to\s+the\s+front|metal\s+piece|loose\s+(?:step|stair|metal)|broken\s+(?:step|stair|railing|handrail))\b/i

const DECK_RE =
  /\b(deck|decking|deck\s*board|deck\s*builder|porch\s*deck)\b/i

const MASONRY_RE =
  /\b(mason|masonry|brick(?:work)?|stone(?:work)?|mortar|chimney|retaining\s*wall)\b/i

const CONCRETE_RE =
  /\b(concrete|cement|sidewalk|driveway\s*(?:crack|slab)|concrete\s*(?:step|stairs?|pad|slab|contractor))\b/i

const ROOF_RE =
  /\b(roof|roofing|shingle|ceiling\s*leak|water\s*from\s*(?:the\s*)?ceiling|pouring\s*(?:from|through)\s*(?:the\s*)?ceiling)\b/i

const CLEANING_RE = /\b(clean(?:ing)?|deep\s*clean|janitor|carpet\s*clean)\b/i
const PAINT_RE = /\b(paint(?:ing)?|peeling\s*paint)\b/i
const FLOOR_RE = /\b(floor(?:ing)?|carpet|tile|hardwood)\b/i
const WINDOW_RE = /\b(window|windows|screen|sliding\s*door)\b/i
const LANDSCAPE_RE = /\b(lawn|landscap|grounds|yard|tree)\b/i
const CARPENTRY_RE = /\b(cabinets?|carpenter|carpentry|shelf|shelves|trim)\b/i
const HANDYMAN_RE =
  /\b(handyman|handy\s*man|general\s*maintenance|odd\s*job)\b/i

const GAS_RE = /\b(gas\s*smell|smell\s*(?:of\s*)?gas|gas\s*leak|natural\s*gas)\b/i
const FIRE_RE = /\b(fire|smoke|flames?|burning)\b/i
const FLOOD_ACTIVE_RE =
  /\b(pouring|gushing|flooding|water\s*everywhere|burst|active\s*leak|soaking)\b/i

const INJURY_RE =
  /\b(?:hurt|injured|injury|almost\s+hurt|nearly\s+hurt|cut\s+(?:my|her|his|their)|trip(?:ped|ping)?|slip(?:ped|ping)?|fell|fall(?:ing)?|catch(?:ed|ing)?\s+onto|caught\s+onto|sandal|unsafe|sharp\s+edge|hazard)\b/i

export function matchDeterministicRules(text: string): RuleHit[] {
  const hay = text.toLowerCase()
  const hits: RuleHit[] = []

  const push = (
    re: RegExp,
    trade: VendorTrade,
    issueType: IssueType,
    weight: number,
    severityBoost: SeverityLevel | null = null,
    emergency: EmergencyType = 'none',
  ) => {
    const m = hay.match(new RegExp(re.source, 'gi'))
    if (!m?.length) return
    hits.push({
      trade,
      issueType,
      keywords: [...new Set(m.map((x) => x.toLowerCase()))],
      severityBoost,
      emergency,
      weight: weight + Math.min(0.15, m.length * 0.03),
    })
  }

  if (GAS_RE.test(hay)) {
    hits.push({
      trade: 'other',
      issueType: 'other',
      keywords: ['gas'],
      severityBoost: 'critical',
      emergency: 'gas',
      weight: 1.2,
    })
  }
  if (FIRE_RE.test(hay) && /\b(smoke|fire|flame)/i.test(hay)) {
    hits.push({
      trade: 'electrical',
      issueType: 'electrical',
      keywords: ['fire/smoke'],
      severityBoost: 'critical',
      emergency: 'fire',
      weight: 1.15,
    })
  }

  push(
    PLUMBING_RE,
    'plumbing',
    /\bleak|drip|flood|overflow/i.test(hay) ? 'leak' : 'plumbing',
    0.92,
    /\b(overflow|flood|gushing|pouring)\b/i.test(hay) ? 'urgent' : null,
  )
  push(ELECTRICAL_RE, 'electrical', 'electrical', 0.9, /\bspark/i.test(hay) ? 'urgent' : null)
  push(HVAC_RE, 'hvac', 'hvac', 0.88)
  push(APPLIANCE_RE, 'appliance_repair', 'appliance', 0.86)
  push(
    LOCK_RE,
    'locksmith',
    'lock',
    0.9,
    /\blocked\s*out/i.test(hay) ? 'urgent' : null,
    /\blocked\s*out/i.test(hay) ? 'lockout' : 'none',
  )
  push(PEST_RE, 'pest_control', 'pest', 0.91)
  push(DOOR_HARDWARE_RE, 'carpentry', 'general', 0.78)

  push(DECK_RE, 'deck_builder', 'general', 0.88)
  push(MASONRY_RE, 'masonry', 'general', 0.86)
  push(CONCRETE_RE, 'concrete', 'general', 0.86)

  const hasPest = hits.some((h) => h.trade === 'pest_control')
  if (hasPest && APPLIANCE_AS_LOCATION_RE.test(hay)) {
    for (let i = hits.length - 1; i >= 0; i--) {
      if (hits[i]?.trade === 'appliance_repair') hits.splice(i, 1)
    }
  }

  const stairsHit = STAIRS_ENTRANCE_RE.test(hay) &&
    !(/\bnext\s+steps?\b/i.test(hay) &&
      !/\b(?:stairs?|stairway|handrail|railing|front\s+step)/i.test(hay))
  const injuryHit = INJURY_RE.test(hay)
  if (stairsHit) {
    const materialSpecialist =
      DECK_RE.test(hay) || MASONRY_RE.test(hay) || CONCRETE_RE.test(hay)
    if (!materialSpecialist) {
      push(
        STAIRS_ENTRANCE_RE,
        'carpentry',
        'general',
        0.9,
        injuryHit ? 'urgent' : null,
        injuryHit ? 'habitability' : 'none',
      )
    } else if (injuryHit) {
      hits.push({
        trade: DECK_RE.test(hay)
          ? 'deck_builder'
          : MASONRY_RE.test(hay)
            ? 'masonry'
            : 'concrete',
        issueType: 'general',
        keywords: ['injury risk'],
        severityBoost: 'urgent',
        emergency: 'habitability',
        weight: 0.95,
      })
    }
  } else if (injuryHit && /\b(broken|loose|sharp|edge|metal)\b/i.test(hay)) {
    hits.push({
      trade: 'general',
      issueType: 'general',
      keywords: ['injury risk'],
      severityBoost: 'urgent',
      emergency: 'habitability',
      weight: 0.82,
    })
  }

  push(ROOF_RE, 'roofing', 'roofing', 0.85)
  push(CLEANING_RE, 'cleaning', 'general', 0.7)
  push(PAINT_RE, 'painting', 'general', 0.7)
  push(FLOOR_RE, 'flooring', 'general', 0.7)
  push(WINDOW_RE, 'windows', 'general', 0.72)
  push(LANDSCAPE_RE, 'landscaping', 'general', 0.7)
  push(CARPENTRY_RE, 'carpentry', 'general', 0.7)
  push(HANDYMAN_RE, 'general', 'general', 0.75)

  if (FLOOD_ACTIVE_RE.test(hay) && PLUMBING_RE.test(hay)) {
    hits.push({
      trade: 'plumbing',
      issueType: 'leak',
      keywords: ['active water'],
      severityBoost: 'urgent',
      emergency: 'flood',
      weight: 1.05,
    })
  }

  if (/\bno\s*heat\b/i.test(hay) || /\bfreezing\b/i.test(hay)) {
    hits.push({
      trade: 'hvac',
      issueType: 'hvac',
      keywords: ['no heat / freezing'],
      severityBoost: 'urgent',
      emergency: 'habitability',
      weight: 1.0,
    })
  }

  hits.sort((a, b) => b.weight - a.weight)
  return hits
}

export function inferTradeFromText(text: string): VendorTrade | null {
  const hits = matchDeterministicRules(text)
  const top = hits[0]
  if (!top || top.weight < 0.7) return null
  if (top.emergency === 'gas') return 'other'
  return top.trade
}

export function inferIssueTypeFromRules(text: string): IssueType | null {
  const hits = matchDeterministicRules(text)
  return hits[0]?.issueType ?? null
}

/** True when description text suggests HVAC / cooling (shared inbox + monitoring heuristics). */
export function mentionsHvacCooling(text: string): boolean {
  return HVAC_RE.test(text)
}
