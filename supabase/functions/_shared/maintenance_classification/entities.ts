import { matchDeterministicRules } from "./deterministicRules.ts"
import type { ClassificationEntities, EmergencyType } from "./types.ts"

const ROOM_RE =
  /\b(kitchen|bathroom|bath|bedroom|living\s*room|basement|laundry|utility|hallway|closet|balcony|garage|attic|front\s*entrance|entrance|entryway|stairs?|stairway|deck|porch)\b/i

const OBJECT_RE =
  /\b(faucet|tap|sink|basin|toilet|pipe|drain|outlet|breaker|fridge|refrigerator|washer|dryer|oven|stove|dishwasher|thermostat|furnace|ac|window|door|lock|ceiling|roof|step|stairs?|handrail|railing|metal\s*piece|nosing|deck)\b/i

const DURATION_RE =
  /\b(since\s+[\w\s]{1,24}|for\s+\d+\s+(?:hour|day|week|minute)s?|last\s+night|yesterday|this\s+morning|all\s+day)\b/i

export function extractEntities(sanitized: string): ClassificationEntities {
  const hay = sanitized.toLowerCase()
  const hits = matchDeterministicRules(sanitized)
  const top = hits[0] ?? null

  const locationMatch = sanitized.match(ROOM_RE)
  const objectMatch = sanitized.match(OBJECT_RE)
  const durationMatch = sanitized.match(DURATION_RE)

  const safetyRisks: string[] = []
  if (/\bspark/i.test(hay)) safetyRisks.push("sparks")
  if (/\bgas\b/i.test(hay)) safetyRisks.push("gas")
  if (/\bsmoke|fire\b/i.test(hay)) safetyRisks.push("fire/smoke")
  if (/\bflood|pouring|gushing|water\s+everywhere\b/i.test(hay)) {
    safetyRisks.push("active water")
  }
  if (/\blocked\s*out\b/i.test(hay)) safetyRisks.push("lockout")
  if (/\bno\s*heat\b/i.test(hay)) safetyRisks.push("no heat")
  if (
    /\b(?:hurt|injured|injury|almost\s+hurt|trip(?:ped|ping)?|slip(?:ped|ping)?|fell|fall(?:ing)?|caught\s+onto|sharp\s+edge|hazard)\b/i
      .test(hay)
  ) {
    safetyRisks.push("injury risk")
  }

  const activeDamage =
    /\b(wet|soaking|damage|damaged|flood|pouring|spreading|mold)\b/i.test(hay)
  const damageType = /\bwater\b/i.test(hay)
    ? "water"
    : /\bfire|smoke|burn\b/i.test(hay)
    ? "fire"
    : null

  const emergencyType: EmergencyType = top?.emergency ?? "none"

  const missingInfo: string[] = []
  if (!top) missingInfo.push("issue_source")
  if (!locationMatch && !objectMatch) missingInfo.push("location_or_fixture")

  const severityIndicators: string[] = []
  if (top?.severityBoost) severityIndicators.push(top.severityBoost)
  if (activeDamage) severityIndicators.push("active_damage")
  for (const r of safetyRisks) severityIndicators.push(r)

  return {
    issueType: top?.issueType ?? null,
    vendorTrade: top?.trade ?? null,
    affectedObject: objectMatch?.[1]?.toLowerCase() ?? objectMatch?.[0]?.toLowerCase() ?? null,
    location: locationMatch?.[1]?.toLowerCase() ?? locationMatch?.[0]?.toLowerCase() ?? null,
    propertyHint: null,
    buildingHint: null,
    unitHint: null,
    severityIndicators,
    safetyRisks,
    activeDamage,
    damageType,
    duration: durationMatch?.[0] ?? null,
    recurring: /\b(again|recurring|keeps|still|returned)\b/i.test(hay),
    accessConstraints: /\b(no\s*access|gate|lockbox|dog|pet)\b/i.test(hay)
      ? "mentioned"
      : null,
    residentAvailability: /\b(?:available|availability|saturday|sunday|after\s+\d|between\s+\d)\b/i
        .test(hay)
      ? "mentioned"
      : null,
    photoMentioned: /\b(photo|picture|pic|image|attached)\b/i.test(hay),
    missingInfo,
    emergencyType,
  }
}
