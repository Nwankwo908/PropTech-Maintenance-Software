/**
 * Deterministic trade / issue / safety rules — shared source of truth for keyword signals.
 */
import type {
  EmergencyType,
  IssueType,
  SeverityLevel,
  VendorTrade,
} from "./types.ts"

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
  /\b(pest|roach(?:es)?|mouse|mice|rat|rats|bug|bugs|insect|termite|infestation)\b/i

const ROOF_RE =
  /\b(roof|roofing|shingle|ceiling\s*leak|water\s*from\s*(?:the\s*)?ceiling|pouring\s*(?:from|through)\s*(?:the\s*)?ceiling)\b/i

const CLEANING_RE = /\b(clean(?:ing)?|deep\s*clean|janitor|carpet\s*clean)\b/i
const PAINT_RE = /\b(paint(?:ing)?|peeling\s*paint)\b/i
const FLOOR_RE = /\b(floor(?:ing)?|carpet|tile|hardwood)\b/i
const WINDOW_RE = /\b(window|windows|screen|sliding\s*door)\b/i
const LANDSCAPE_RE = /\b(lawn|landscap|grounds|yard|tree)\b/i
const CARPENTRY_RE = /\b(cabinet|carpenter|carpentry|shelf|trim)\b/i

const GAS_RE = /\b(gas\s*smell|smell\s*(?:of\s*)?gas|gas\s*leak|natural\s*gas)\b/i
const FIRE_RE = /\b(fire|smoke|flames?|burning)\b/i
const FLOOD_ACTIVE_RE =
  /\b(pouring|gushing|flooding|water\s*everywhere|burst|active\s*leak|soaking)\b/i

/** Map free text → strongest deterministic trade hits (may be multiple). */
export function matchDeterministicRules(text: string): RuleHit[] {
  const hay = text.toLowerCase()
  const hits: RuleHit[] = []

  const push = (
    re: RegExp,
    trade: VendorTrade,
    issueType: IssueType,
    weight: number,
    severityBoost: SeverityLevel | null = null,
    emergency: EmergencyType = "none",
  ) => {
    const m = hay.match(new RegExp(re.source, "gi"))
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
      trade: "other",
      issueType: "other",
      keywords: ["gas"],
      severityBoost: "critical",
      emergency: "gas",
      weight: 1.2,
    })
  }
  if (FIRE_RE.test(hay) && /\b(smoke|fire|flame)/i.test(hay)) {
    hits.push({
      trade: "electrical",
      issueType: "electrical",
      keywords: ["fire/smoke"],
      severityBoost: "critical",
      emergency: "fire",
      weight: 1.15,
    })
  }

  push(
    PLUMBING_RE,
    "plumbing",
    /\bleak|drip|flood|overflow/i.test(hay) ? "leak" : "plumbing",
    0.92,
    /\b(overflow|flood|gushing|pouring)\b/i.test(hay) ? "urgent" : null,
  )
  push(ELECTRICAL_RE, "electrical", "electrical", 0.9, /\bspark/i.test(hay) ? "urgent" : null)
  push(HVAC_RE, "hvac", "hvac", 0.88)
  push(APPLIANCE_RE, "appliance_repair", "appliance", 0.86)
  push(LOCK_RE, "locksmith", "lock", 0.9, /\blocked\s*out/i.test(hay) ? "urgent" : null, /\blocked\s*out/i.test(hay) ? "lockout" : "none")
  push(PEST_RE, "pest_control", "pest", 0.84)
  push(ROOF_RE, "roofing", "roofing", 0.85)
  push(CLEANING_RE, "cleaning", "general", 0.7)
  push(PAINT_RE, "painting", "general", 0.7)
  push(FLOOR_RE, "flooring", "general", 0.7)
  push(WINDOW_RE, "windows", "general", 0.72)
  push(LANDSCAPE_RE, "landscaping", "general", 0.7)
  push(CARPENTRY_RE, "carpentry", "general", 0.7)

  if (FLOOD_ACTIVE_RE.test(hay) && PLUMBING_RE.test(hay)) {
    hits.push({
      trade: "plumbing",
      issueType: "leak",
      keywords: ["active water"],
      severityBoost: "urgent",
      emergency: "flood",
      weight: 1.05,
    })
  }

  if (/\bno\s*heat\b/i.test(hay) || /\bfreezing\b/i.test(hay)) {
    hits.push({
      trade: "hvac",
      issueType: "hvac",
      keywords: ["no heat / freezing"],
      severityBoost: "urgent",
      emergency: "habitability",
      weight: 1.0,
    })
  }

  hits.sort((a, b) => b.weight - a.weight)
  return hits
}

/**
 * Infer vendor trade from free text (used by vendor_trades normalization + pipeline).
 * Returns null when no strong match (caller may fall back to other).
 */
export function inferTradeFromText(text: string): VendorTrade | null {
  const hits = matchDeterministicRules(text)
  const top = hits[0]
  if (!top || top.weight < 0.7) return null
  if (top.emergency === "gas") return "other"
  return top.trade
}

export function inferIssueTypeFromRules(text: string): IssueType | null {
  const hits = matchDeterministicRules(text)
  return hits[0]?.issueType ?? null
}
