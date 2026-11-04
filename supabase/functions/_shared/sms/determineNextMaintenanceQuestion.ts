/**
 * Dynamic SMS intake questions. Tenants give facts; Ulo classifies urgency/trade.
 * Ask only when the answer would change safety handling, routing, or next steps.
 */
import {
  indicatesImmediateHeatDanger,
  parseDurationHours,
} from "../../../../shared/maintenance/urgencyPolicy.ts"
import {
  classifySelfFixReply,
  shouldOfferSelfFix,
} from "../../../../shared/maintenance/selfFixTips.ts"
import { matchesWaterOutage } from "../../../../shared/maintenance/deterministicRules.ts"
import { detectRecurringIssueSignal } from "../../../../shared/maintenance/recurringIssueSignal.ts"
import {
  acceptItemDetailAnswer,
  itemDetailQuestion,
} from "../../../../shared/maintenance/itemDetail.ts"
import {
  acceptLocationReply,
  clarifyIssueLocation,
} from "../../../../shared/maintenance/locationClarification.ts"
import { interpretConfirmedLocation } from "../../../../shared/maintenance/requestConfirmation.ts"
import {
  activeSafetyNotes,
  formatSafetyNotes,
  parseSafetyNotes,
  resolveSafetyNote,
  resolvedSafetyNotes,
  safetyConcernSentence,
  upsertActiveSafetyNote,
} from "../../../../shared/maintenance/safetyNotes.ts"
import {
  applyPhotoRequestPolicy,
  applyRecurringIssueSignal,
  computeIntakeSeverity,
  extractRoomFromText,
  inferIssueTypeFromText,
  recommendUrgency,
  resolveRoomLabel,
  shouldRequestIntakePhoto,
  type IntakeStep,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import { VAGUE_MAINTENANCE_QUESTION } from "../maintenance_classification/clarification.ts"
import { isVagueTicketDescription, looksLikeBareRepairRequest } from "./clarifyMenuIntakeSeed.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import {
  stripSystemIntakeText,
  SYSTEM_SAFETY_NOTES,
  TENANT_UPDATE_PREFIX,
  tenantAuthoredText,
} from "./intakeSystemText.ts"

export type MaintenanceQuestionType =
  | "classification_clarification"
  | "issue_type"
  | "room_or_area"
  | "plumbing_overflow"
  | "plumbing_active_flow"
  | "plumbing_hot_water_scope"
  | "plumbing_water_outage_scope"
  | "toilet_overflow"
  | "toilet_only"
  | "hvac_behavior"
  | "hvac_heat_check"
  | "hvac_dangerous_temp"
  | "electrical_scope"
  | "electrical_hazard"
  | "appliance_symptom"
  | "pest_frequency"
  | "pest_location"
  | "structural_risk"
  | "safety_concern_status"
  | "door_part"
  | "door_safety"
  | "lock_secure"
  | "general_clarify"
  | "symptom_clarify"
  | "duration_material"
  | "photo"
  | "unit_entry"
  | "item_detail"
  | "self_fix"

export type NextMaintenanceQuestion =
  | {
    shouldAsk: true
    questionType: MaintenanceQuestionType
    question: string
    step: IntakeStep
    tipId?: string
  }
  | { shouldAsk: false }

function haystack(state: SmsIntakeState): string {
  return [
    state.initial_message,
    state.description,
    state.safety_concerns,
    ...Object.values(state.diagnostic_facts ?? {}),
    ...(state.clarification_answers ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function fact(state: SmsIntakeState, type: string): string {
  return (state.diagnostic_facts?.[type] ?? "").trim().toLowerCase()
}

function asked(state: SmsIntakeState, type: MaintenanceQuestionType): boolean {
  return (state.asked_question_types ?? []).includes(type)
}

function isYes(text: string): boolean {
  return /^(y|yes|yeah|yep|yup|yea)\b/.test(text.trim().toLowerCase()) ||
    /\b(it is|still is|overflowing|pouring|flowing)\b/i.test(text)
}

/** Short follow-up when a flow answer does not say whether water is uncontrolled. */
export const WATER_FLOW_CLARIFICATION =
  "Is water pouring out or pooling on the floor, or is it only a slow drip?"

const WATER_FLOW_UNCERTAIN =
  /\b(?:might|may|maybe|perhaps|possibly|i think|not sure|unsure|don'?t know|do not know|haven'?t checked|have not checked|didn'?t check|did not check)\b/i

function deniesWaterOnFloor(text: string): boolean {
  return /\bno water (?:is )?on the floor\b/i.test(text) ||
    /\b(?:no|not|without|isn'?t|is not)\b[^.]{0,40}\bwater\b[^.]{0,24}\b(?:on|onto)\s+the\s+floor\b/i.test(text)
}

/**
 * Full answer to "is water still flowing?"
 * A bare "leaking" is not uncontrolled flow. Pouring or water on the floor is.
 */
export function readWaterFlowAnswer(
  answer: string,
): "uncontrolled" | "contained" | "uncertain" | "ambiguous" {
  const text = answer.replace(/\s+/g, " ").trim()
  if (!text) return "ambiguous"
  const noFloor = deniesWaterOnFloor(text)
  const deniedFlow =
    /\b(?:not|no|isn'?t|is not|without|no longer)\s+(?:actively\s+)?(?:overflowing|flooding|pouring|gushing|flowing|leaking)\b/i
      .test(text)
  const uncontrolled = !noFloor && !deniedFlow &&
    /\b(?:pour(?:ing|s)?|gush(?:ing|es)?|flood(?:ing|ed)?|overflow(?:ing)?|water everywhere|pooling|pooled|onto the floor|on the floor|still\s+(?:flowing|pouring|gushing)|actively\s+(?:flowing|overflowing|leaking))\b/i
      .test(text)
  const contained =
    /\b(?:dripping slowly|slow drip|only dripping|just a drip|just dripping)\b/i.test(text) ||
    noFloor ||
    /\b(?:not|no|isn'?t|is not)\s+(?:actively\s+)?(?:overflowing|flooding|pouring|gushing|flowing)\b/i.test(text) ||
    /\b(?:the\s+)?water\s+(?:has\s+|have\s+)?stopped\b/i.test(text) ||
    /^(?:no|nope|nah)\b/i.test(text)
  if (WATER_FLOW_UNCERTAIN.test(text) && !/^(?:y|yes|yeah|yep|yup)\b/i.test(text)) {
    return "uncertain"
  }
  if (uncontrolled) return "uncontrolled"
  if (contained) return "contained"
  if (/^(?:y|yes|yeah|yep|yup)\b/i.test(text)) return "uncontrolled"
  if (/\b(?:leak(?:ing|s)?)\b/i.test(text)) return "ambiguous"
  return "ambiguous"
}

function isNo(text: string): boolean {
  return /^(n|no|nope|nah)\b/.test(text.trim().toLowerCase()) ||
    /\b(not overflowing|not leaking|no leak|none|it'?s not)\b/i.test(text)
}

/** unit_entry: resident is unsure — proceed with permission unconfirmed. */
export function isUnitEntryNotSure(text: string): boolean {
  const t = text.trim().toLowerCase()
  return (
    /^(not\s+sure|unsure|idk|i\s*don'?t\s+know|dont\s+know|unknown|maybe)\b/.test(t) ||
    /\b(not\s+sure\s+yet|don'?t\s+know\s+yet)\b/.test(t)
  )
}

function hasFixture(hay: string): boolean {
  return /\b(sink|toilet|faucet|tub|shower|dishwasher|washer|dryer|fridge|refrigerator|oven|stove|outlet|breaker)\b/i
    .test(hay)
}

function isPlumbing(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("plumb") || cat === "leak" ||
    /\b(sink|toilet|clog|leak|drain|faucet|hot water)\b/.test(hay)
}

function isHvac(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("hvac") || /\b(ac|air condition|heat(?:er|ing)?|furnace|no heat|no cooling)\b/.test(hay)
}

const HVAC_HEAT_CHECK_QUESTION =
  "How hot is it inside, and is anyone feeling unwell? Is the AC blowing warm air or not turning on at all?"

function hotOutdoor(state: SmsIntakeState): boolean {
  return state.outdoor_temp_f != null && state.outdoor_temp_f >= 85
}

function isCoolingFailure(tenantHay: string): boolean {
  return /\b(no\s+cool(?:ing)?|ac\s+(?:not|isn'?t|n'?t)\s+working|air\s*condition(?:er|ing)?\s+(?:not|isn'?t)|won'?t\s+cool|blowing\s+warm)\b/
    .test(tenantHay) ||
    (/\b(ac|a\/c|air\s*condition)/.test(tenantHay) &&
      /\b(not|isn'?t|n'?t|won'?t|broken|out|down|dead|warm)\b/.test(tenantHay))
}

function knowsIndoorTemp(tenantHay: string): boolean {
  return /\b\d{2,3}\s*(?:degrees|°|f)\b/.test(tenantHay) ||
    /\b\d{2,3}\b[^.]{0,16}\b(?:inside|indoor|in here)\b/.test(tenantHay) ||
    /\b(?:inside|indoor|in here|in the (?:house|apartment|unit|home))\b[^.]{0,24}\b\d{2,3}\b/.test(tenantHay) ||
    /\b(?:very|really|so)\s+hot\s+inside\b/.test(tenantHay)
}

function knowsWellness(tenantHay: string): boolean {
  return indicatesImmediateHeatDanger(tenantHay) ||
    /\b(no\s*one|nobody)\b[^.]{0,40}\b(unwell|sick|ill)\b/.test(tenantHay) ||
    /\b(feeling|feels)\s+(?:fine|ok|okay|alright)\b/.test(tenantHay) ||
    /\b(?:everyone|we)\s+(?:is|are|'re)\s+(?:fine|ok|okay)\b/.test(tenantHay) ||
    /\b(?:we'?re|i'?m|everyone is)\s+(?:ok|okay|fine)\b/.test(tenantHay)
}

function knowsAcBehavior(tenantHay: string): boolean {
  return /\b(blowing\s+warm|warm\s+air|not\s+turning\s+on|won'?t\s+turn\s+on|will\s+not\s+turn\s+on|no\s+airflow|running\s+but)\b/
    .test(tenantHay)
}

function acBehaviorPhrase(answer: string): string | null {
  const hay = answer.toLowerCase()
  if (/\b(not\s+turning\s+on|won'?t\s+turn\s+on|will\s+not\s+turn\s+on|no\s+airflow)\b/.test(hay)) {
    return "not turning on"
  }
  if (/\b(blowing\s+warm|warm\s+air|running\s+but)\b/.test(hay)) return "blowing warm air"
  return null
}

/** Ask only the heat details the resident has not already given. */
function heatCheckQuestion(tenantHay: string): string | null {
  const temp = !knowsIndoorTemp(tenantHay)
  const well = !knowsWellness(tenantHay)
  const behavior = !knowsAcBehavior(tenantHay)
  if (!temp && !well && !behavior) return null
  if (temp && well && behavior) return HVAC_HEAT_CHECK_QUESTION
  const parts: string[] = []
  if (temp && well) parts.push("How hot is it inside, and is anyone feeling unwell?")
  else if (temp) parts.push("How hot is it inside?")
  else if (well) parts.push("Is anyone feeling unwell?")
  if (behavior) parts.push("Is the AC blowing warm air or not turning on at all?")
  return parts.join(" ")
}

function isElectrical(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("electric") || /\b(outlet|breaker|spark|power out)\b/.test(hay)
}

function isAppliance(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("appliance") ||
    /\b(washer|washing machine|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave)\b/
      .test(hay)
}

type NamedAppliance =
  | "freezer"
  | "fridge"
  | "washer"
  | "dryer"
  | "dishwasher"
  | "oven"
  | "stove"
  | "microwave"

/** Kept for an appliance report that does not name one of the appliances above. */
export const GENERIC_APPLIANCE_SYMPTOM_QUESTION =
  "What happens when you try to start it? For example: won't power on, won't drain, leaking, loud noise, stuck door, or something else."

const APPLIANCE_WATER_ON_FLOOR =
  /\b(pouring|leaking onto|water on the floor)\b/i

const APPLIANCE_MENTION =
  /\b(freezer|dishwasher|washing machine|washer|dryer|microwave|oven|stove|fridge|refrigerator)\b/i

/** A real failure mode. "Broken" or "not working" is not specific enough. Leak words are handled separately so a negated leak is not treated as the symptom. */
const STATED_APPLIANCE_SYMPTOM =
  /\b(?:not cooling|isn'?t cooling|won'?t cool|will not cool|not cold|isn'?t cold|warm|thaw(?:ing|ed)?|frost|iced over|ice build(?:-|\s)?up|not running|isn'?t running|won'?t run|will not run|not starting|won'?t start|will not start|won'?t turn on|will not turn on|won'?t power on|will not power on|no power|not draining|won'?t drain|will not drain|doesn'?t drain|loud|nois(?:e|y)|banging|grinding|stuck door|door (?:is )?stuck|door won'?t|not heating|isn'?t heating|won'?t heat|will not heat|not tumbling|won'?t tumble|not spinning|won'?t spin|not cleaning|won'?t clean|not lighting|won'?t light|burner|spark(?:ing|s)?|turntable|not freezing|isn'?t freezing)\b/i

/** A leak the resident has taken back, or one they say has already stopped. */
const NEGATED_OR_RESOLVED_LEAK =
  /\b(?:(?:is|was|are|were)n'?t|(?:is|was|are|were) not|aren'?t|are not|not|no|without|never|no longer|stopped|has stopped|have stopped)\s+(?:actively\s+)?(?:leaking|leaks?)\b|\b(?:was|were)\s+leaking\b[^.]{0,48}\b(?:stopped|quit|isn'?t|is not|not anymore|no longer)\b|\bleaking\s+(?:has\s+|have\s+)?(?:stopped|quit)\b|\bno\s+leak\b/gi

/** Clear confirmation that the leak is over. Uncertainty is a separate check. */
const LEAK_CLEARLY_STOPPED =
  /\b(?:the\s+)?leaks?\s+(?:has\s+|have\s+)?(?:stopped|is over|is fixed)\b|\bstopped\s+leaking\b|\bno longer leaking\b|\b(?:isn'?t|is not|it is not|it'?s not)\s+leaking(?:\s+anymore|\s+now)?\b|\bnot\s+leaking(?:\s+anymore|\s+now)\b|\b(?:was|were)\s+leaking\b[^.]{0,48}\b(?:stopped|quit|isn'?t|is not|not anymore|no longer)\b|\bleaking\s+(?:has\s+|have\s+)?(?:stopped|quit)\b|\bno\s+leak\b/i

/** The resident is not sure. This must not resolve or reopen a leak by itself. */
const LEAK_UNCERTAIN =
  /\b(?:might|may|maybe|perhaps|possibly|i think|not sure|unsure|don'?t know|do not know|haven'?t checked|have not checked|didn'?t check|did not check|haven'?t looked|have not looked)\b/i

/** A current leak, including one that started again. */
const LEAK_AFFIRMATIVE =
  /\b(?:still leaking|leaking again|(?:leak|leaking) is back|it(?:'s| is) leaking|is leaking|started leaking)\b/i

function withoutStoppedLeakPhrases(text: string): string {
  return text
    .replace(new RegExp(LEAK_CLEARLY_STOPPED.source, "gi"), " ")
    .replace(new RegExp(NEGATED_OR_RESOLVED_LEAK.source, "gi"), " ")
}

function reportsActiveApplianceLeak(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw) return false
  if (LEAK_UNCERTAIN.test(raw) && !LEAK_AFFIRMATIVE.test(raw)) return false
  const remaining = withoutStoppedLeakPhrases(raw)
  if (!deniesWaterOnFloor(remaining) && APPLIANCE_WATER_ON_FLOOR.test(remaining)) return true
  if (
    !deniesWaterOnFloor(remaining) &&
    /\bpour(?:ing|s)?\b/i.test(remaining) &&
    /\b(?:onto|on)\s+the\s+floor\b/i.test(remaining)
  ) {
    return true
  }
  return /\b(?:leaking|leaks|leak)\b/i.test(remaining)
}

function leakSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function latestSentence(text: string): string {
  const parts = leakSentences(text)
  return parts[parts.length - 1] ?? text.trim()
}

function sentenceIsCurrent(current: string, sentence: string | null): boolean {
  if (!sentence) return false
  return current === sentence || current.includes(sentence)
}

/** The latest sentence that talks about a leak. An earlier "leaking" must not outvote it. */
function latestMatchingSentence(text: string, mention: RegExp): string | null {
  const parts = leakSentences(text)
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (mention.test(parts[index])) return parts[index]
  }
  return null
}

function latestLeakSentence(text: string): string | null {
  return latestMatchingSentence(text, /\b(?:leak(?:ing|s)?|pour(?:ing|s)?)\b/i)
}

const SPARK_MENTION = /\b(?:spark(?:ing|s|ed)?|burning smell|smells? like (?:smoke|burning)|smoke)\b/i
const SPARK_STOPPED =
  /\b(?:stopped sparking|not sparking|no longer sparking|isn'?t sparking|is not sparking|sparks? (?:have |has )?stopped|sparking (?:has |have )?stopped|no more sparks|smoke (?:has )?stopped|no more smoke|burning smell (?:has |have )?stopped)\b/i
const SPARK_AFFIRMATIVE =
  /\b(?:sparking again|sparks? (?:are )?back|still sparking|it(?:'s| is) sparking|is sparking|there are sparks|i see sparks)\b/i

const HEAT_MENTION = /\b(?:overheat(?:ing|ed)?|too hot|dangerously hot|dangerously cold)\b/i
const HEAT_STOPPED =
  /\b(?:stopped overheating|not overheating|no longer overheating|isn'?t overheating|is not overheating|overheating (?:has |have )?stopped|cooled down|has cooled down)\b/i
const HEAT_AFFIRMATIVE =
  /\b(?:overheating again|still overheating|it(?:'s| is) overheating|is overheating|too hot|dangerously hot|dangerously cold)\b/i

function mentionsAppliance(state: SmsIntakeState | undefined, text: string): boolean {
  if (namedAppliance(text)) return true
  const cat = `${state?.primary_category ?? ""} ${state?.issue_type ?? ""} ${state?.vendor_trade ?? ""}`
    .toLowerCase()
  return cat.includes("appliance")
}

function concernIsResolved(
  current: string | null | undefined,
  note: string,
): boolean {
  const key = note.trim().toLowerCase()
  return resolvedSafetyNotes(current).some((item) => item.trim().toLowerCase() === key)
}

function applyConcernUpdate(
  current: string | null | undefined,
  latest: string | null,
  note: string,
  uncertain: RegExp,
  affirmative: RegExp,
  stopped: RegExp,
  active: (sentence: string) => boolean,
  sentenceIsLatest: boolean,
): string | undefined {
  const existing = current?.trim() || undefined
  if (!latest) return existing
  // An older report must not reopen a concern a later reply already stopped.
  if (!sentenceIsLatest && concernIsResolved(existing, note)) return existing
  if (uncertain.test(latest) && !affirmative.test(latest)) return existing
  if (affirmative.test(latest) || active(latest)) {
    return upsertActiveSafetyNote(existing, note)
  }
  if (stopped.test(latest)) return resolveSafetyNote(existing, note)
  return existing
}

/**
 * Record a supported concern once, beside any other note.
 * A clear stop keeps that concern as history. Uncertainty leaves it active.
 * Saying the same problem started again makes that note active, not a second copy.
 */
function applyReportedSafetyUpdates(
  current: string | null | undefined,
  text: string,
  state?: SmsIntakeState,
): string | undefined {
  const raw = text.replace(/\s+/g, " ").trim()
  let next = current?.trim() || undefined
  const currentSentence = latestSentence(raw)
  const leak = latestLeakSentence(raw)
  const spark = latestMatchingSentence(raw, SPARK_MENTION)
  const heat = latestMatchingSentence(raw, HEAT_MENTION)
  if (leak && mentionsAppliance(state, raw)) {
    next = applyConcernUpdate(
      next,
      leak,
      SYSTEM_SAFETY_NOTES.applianceLeak,
      LEAK_UNCERTAIN,
      LEAK_AFFIRMATIVE,
      LEAK_CLEARLY_STOPPED,
      (sentence) => reportsActiveApplianceLeak(sentence),
      sentenceIsCurrent(currentSentence, leak),
    )
  } else if (leak && LEAK_CLEARLY_STOPPED.test(leak) && !LEAK_UNCERTAIN.test(leak)) {
    next = resolveSafetyNote(next, SYSTEM_SAFETY_NOTES.applianceLeak)
  }
  const hazardOpen = openConcerns(next).some((note) =>
    sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard)
  )
  const partialElectricalStop = Boolean(
    spark &&
      hazardOpen &&
      SPARK_STOPPED.test(spark) &&
      !LEAK_UNCERTAIN.test(spark) &&
      electricalStopIsPartial(spark, raw),
  )
  if (!partialElectricalStop) {
    next = applyConcernUpdate(
      next,
      spark,
      sparkFacetLine(next) ?? SYSTEM_SAFETY_NOTES.electricalHazard,
      LEAK_UNCERTAIN,
      SPARK_AFFIRMATIVE,
      SPARK_STOPPED,
      (sentence) =>
        SPARK_AFFIRMATIVE.test(sentence) ||
        (SPARK_MENTION.test(sentence) &&
          !SPARK_STOPPED.test(sentence) &&
          !/\b(?:no|not|without|isn'?t|is not|no more)\b/i.test(sentence)),
      sentenceIsCurrent(currentSentence, spark),
    )
  }
  next = dropRedundantElectricalTemplate(next)
  next = applyConcernUpdate(
    next,
    heat,
    SYSTEM_SAFETY_NOTES.dangerousTemp,
    LEAK_UNCERTAIN,
    HEAT_AFFIRMATIVE,
    HEAT_STOPPED,
    (sentence) =>
      HEAT_AFFIRMATIVE.test(sentence) ||
      (HEAT_MENTION.test(sentence) &&
        !HEAT_STOPPED.test(sentence) &&
        !/\b(?:no|not|isn'?t|is not|no longer)\b/i.test(sentence)),
    sentenceIsCurrent(currentSentence, heat),
  )
  return next
}

function answerIsKnownConcern(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim()
  return Boolean(
    latestLeakSentence(raw) ||
      latestMatchingSentence(raw, SPARK_MENTION) ||
      latestMatchingSentence(raw, HEAT_MENTION),
  )
}

const CUSTOM_NOTE_STOPWORDS = new Set([
  "the", "a", "an", "is", "it", "its", "was", "are", "be", "to", "of", "and", "or",
  "my", "our", "that", "this", "no", "not", "longer", "anymore", "still", "again",
  "back", "stopped", "has", "have", "been", "now", "just", "really", "very", "too",
  "there", "reported",
])

type CustomSafetyUpdate =
  | { kind: "unchanged" }
  | { kind: "handled" }
  | { kind: "updated"; notes: string | undefined }
  | { kind: "clarify"; question: string }

function stemToken(word: string): string {
  const lower = word.toLowerCase()
  if (lower.length > 5 && lower.endsWith("ing")) return lower.slice(0, -3)
  if (lower.length > 4 && lower.endsWith("ed")) return lower.slice(0, -2)
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1)
  return lower
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !CUSTOM_NOTE_STOPWORDS.has(word))
}

function sameToken(left: string, right: string): boolean {
  const a = stemToken(left)
  const b = stemToken(right)
  if (a === b) return true
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))
}

function openConcerns(current: string | null | undefined): string[] {
  return activeSafetyNotes(current).filter((note) => !/^none reported$/i.test(note))
}

function trackedConcerns(current: string | null | undefined): string[] {
  const parsed = parseSafetyNotes(current)
  return [...parsed.active, ...parsed.resolved].filter((note) => !/^none reported$/i.test(note))
}

function sameConcern(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** Shared words. A paraphrase such as "cooled down" is handled separately. */
function bestNoteMatches(notes: string[], reply: string): string[] {
  const replyTokens = contentTokens(reply)
  if (replyTokens.length === 0) return []
  const scored = notes
    .map((note) => ({
      note,
      score: contentTokens(note).reduce(
        (sum, token) => sum + (replyTokens.some((replyToken) => sameToken(replyToken, token)) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0)
  if (best === 0) return []
  return scored.filter((item) => item.score === best).map((item) => item.note)
}

function concernLabel(note: string): string {
  const sentence = safetyConcernSentence(note, "active") ?? note
  const text = sentence.replace(/[.]+$/g, "").trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function whichConcernQuestion(notes: string[]): string {
  const labels = notes.map(concernLabel)
  if (labels.length === 2) {
    return `Which one has stopped: ${labels[0]}, or ${labels[1]}?`
  }
  const choices = labels.map((label, index) => `${index + 1}. ${label}`).join(" ")
  return `Which concern has stopped? Reply with the number. ${choices}`
}

function isBareStop(text: string): boolean {
  const stripped = text
    .replace(/[.!?]+$/g, "")
    .replace(LEAK_UNCERTAIN, " ")
    .replace(/\s+/g, " ")
    .trim()
  return /^(?:(?:it|that|this)(?:\s+has)?\s+stopped)(?:\s+(?:it|that|this)(?:\s+has)?\s+stopped)*$/i.test(stripped)
}

function hasClearStop(text: string): boolean {
  if (/\bstopped working\b/i.test(text)) return false
  if (/\b(?:not|never|hasn'?t|have not|isn'?t|is not|didn'?t|did not)\s+(?:yet\s+)?stopped\b/i.test(text)) {
    return false
  }
  return /\b(?:no longer|not anymore|has stopped|have stopped|no more|stopped)\b/i.test(text)
}

function deniesMatchedWord(text: string, note: string): boolean {
  const match = text.match(/\b(?:isn'?t|is not|aren'?t|are not)\s+([a-z]+)/i)
  if (!match?.[1]) return false
  return contentTokens(note).some((token) => sameToken(token, match[1]))
}

function replySaysStill(text: string): boolean {
  return /\b(?:still|again)\b/i.test(text) ||
    /\b(?:is|are) back\b/i.test(text) ||
    /\bremains?\b/i.test(text)
}

/**
 * An uncertain status reply, such as "I think it cooled down".
 * Uncertainty blocks resolution even when the words paraphrase a saved note.
 */
function uncertainStatusOnly(text: string): boolean {
  if (!LEAK_UNCERTAIN.test(text)) return false
  const extra = contentTokens(text.replace(LEAK_UNCERTAIN, " "))
  return extra.every((token) =>
    /^(?:cool|cooled|down|stop|stopped|warm|hot|cold|fine|okay|ok|smell|smells|gone|noise|noisy|bang|banging|drip|dripping|leak|leaking|spark|sparking|sparks|smoke|flood|flooding|overflow|overflowing|sagging|hanging|secure)$/.test(token)
  )
}

type ConcernSense =
  | "warmth"
  | "cold"
  | "smell"
  | "smoke"
  | "spark"
  | "noise"
  | "leak"
  | "overflow"
  | "door"
  | "illness"
  | "collapse"
  | "structuralWater"
  | "secure"

const SENSE_WORDS = new Set([
  "warm", "warmth", "hot", "heat", "overheating", "overheat",
  "cooled", "cool", "down", "off", "cold",
  "smell", "smells", "smelling", "odor", "odour", "gone", "burning", "smoke",
  "spark", "sparks", "sparking", "sparked",
  "noise", "noisy", "bang", "banging", "rattle", "rattling", "grind", "grinding", "loud",
  "drip", "dripping", "drippy", "leak", "leaking", "leaks",
  "flood", "flooding", "overflow", "overflowing", "gushing",
  "still", "again", "back", "stopped", "longer", "remains", "remain", "remaining",
  "sagging", "hanging", "secure", "dizzy", "faint", "unwell",
])

const APPLIANCE_SUBJECTS = new Set([
  "outlet", "oven", "stove", "freezer", "fridge", "refrigerator", "washer", "dryer",
  "dishwasher", "furnace", "toilet", "sink", "faucet", "heater", "microwave",
])

type SenseFacet = {
  sense: ConcernSense
  label: string
  subjects: string[]
}

type SenseAction = {
  action: "resolve" | "reactivate"
  sense: ConcernSense
  subjects: string[]
}

function sensesOf(text: string): Set<ConcernSense> {
  const found = new Set<ConcernSense>()
  const raw = text.trim()
  if (/^sparks reported\b/i.test(raw)) {
    found.add("spark")
    return found
  }
  if (/^smoke reported\b/i.test(raw)) {
    found.add("smoke")
    return found
  }
  if (/^burning smell reported\b/i.test(raw)) {
    found.add("smell")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.electricalHazard)) {
    found.add("spark")
    found.add("smoke")
    found.add("smell")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.applianceLeak)) {
    found.add("leak")
    return found
  }
  if (
    sameConcern(raw, SYSTEM_SAFETY_NOTES.overflowYes) ||
    sameConcern(raw, SYSTEM_SAFETY_NOTES.overflowNo)
  ) {
    found.add("overflow")
    return found
  }
  if (
    sameConcern(raw, SYSTEM_SAFETY_NOTES.doorAtRisk) ||
    sameConcern(raw, SYSTEM_SAFETY_NOTES.doorSafe)
  ) {
    found.add("door")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.heatIllness)) {
    found.add("illness")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.structuralCollapse)) {
    found.add("collapse")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.structuralWater)) {
    found.add("structuralWater")
    return found
  }
  if (
    sameConcern(raw, SYSTEM_SAFETY_NOTES.cannotSecure) ||
    sameConcern(raw, SYSTEM_SAFETY_NOTES.canSecure)
  ) {
    found.add("secure")
    return found
  }
  if (sameConcern(raw, SYSTEM_SAFETY_NOTES.dangerousTemp)) {
    found.add("warmth")
    found.add("cold")
    return found
  }
  if (/\b(?:warm|hot|overheat(?:ing|ed)?|too hot)\b/i.test(raw)) found.add("warmth")
  if (/\b(?:dangerously cold|too cold|freezing)\b/i.test(raw)) found.add("cold")
  if (/\b(?:burn(?:ing)?\s+smell|smells?\s+like\s+(?:smoke|burning)|(?:burning|smoke)\s+odor|(?:a\s+)?(?:burning\s+)?smell)\b/i.test(raw)) {
    found.add("smell")
  }
  if (/\bsmoke\b/i.test(raw) && !/\bsmells?\s+like\s+smoke\b/i.test(raw) && !/\bsmoke\s+odor\b/i.test(raw)) {
    found.add("smoke")
  }
  if (/\bspark(?:ing|s|ed)?\b/i.test(raw)) found.add("spark")
  if (/\b(?:loud|bang(?:ing)?|noise|noisy|rattl(?:e|ing)|grind(?:ing)?)\b/i.test(raw)) found.add("noise")
  if (/\b(?:dripp(?:ing|y)?|leak(?:ing|s)?)\b/i.test(raw)) found.add("leak")
  if (/\b(?:overflow(?:ing)?|flood(?:ing)?|gushing)\b/i.test(raw)) found.add("overflow")
  if (/\b(?:door (?:is )?(?:stuck|hanging)|hanging loose|at risk of falling)\b/i.test(raw)) found.add("door")
  if (/\b(?:dizzy|faint|unwell from the heat|feeling faint)\b/i.test(raw)) found.add("illness")
  if (/\b(?:sagging|collapse|collapsing)\b/i.test(raw)) found.add("collapse")
  if (/\bwater coming through\b/i.test(raw)) found.add("structuralWater")
  if (/\b(?:can(?:not|'t) (?:lock|secure)|unable to secure)\b/i.test(raw)) found.add("secure")
  return found
}

function residentEvidence(context: string): string {
  let text = context
  for (const note of Object.values(SYSTEM_SAFETY_NOTES)) {
    text = text.split(note).join(" ")
  }
  return text.replace(/\s+/g, " ").trim()
}

function facetLabel(part: string): string {
  const cleaned = part
    .replace(/[.]+$/g, "")
    .replace(/^(?:there (?:is|are)|i (?:see|hear|smell)|we have)\s+/i, "")
    .trim()
  if (!cleaned) return part.trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function placedLabel(label: string, subjects: string[]): string {
  const places = subjects.filter((token) => APPLIANCE_SUBJECTS.has(token))
  if (places.length !== 1) return label
  if (label.toLowerCase().includes(places[0])) return label
  return `${label} at the ${places[0]}`
}

function andFacets(note: string): SenseFacet[] | null {
  if (sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard)) return null
  if (!/\band\b/i.test(note)) return null
  const parts = note.split(/\s+\band\b\s+/i).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const inherited = subjectsOf(note)
  const facets: SenseFacet[] = []
  for (const part of parts) {
    const senses = [...sensesOf(part)]
    if (senses.length !== 1) return null
    const own = subjectsOf(part)
    facets.push({
      sense: senses[0],
      label: facetLabel(part),
      subjects: own.length > 0 ? own : inherited,
    })
  }
  if (new Set(facets.map((facet) => facet.sense)).size !== facets.length) return null
  return facets
}

function electricalFacetsFromContext(context: string):
  | { kind: "facets"; facets: SenseFacet[] }
  | { kind: "unsure" } {
  const evidence = residentEvidence(context)
  const senses = sensesOf(evidence)
  const subjects = subjectsOf(evidence)
  const facets: SenseFacet[] = []
  if (senses.has("spark")) {
    facets.push({
      sense: "spark",
      label: placedLabel(SYSTEM_SAFETY_NOTES.sparksReported, subjects),
      subjects,
    })
  }
  if (senses.has("smoke")) {
    facets.push({
      sense: "smoke",
      label: placedLabel(SYSTEM_SAFETY_NOTES.smokeReported, subjects),
      subjects,
    })
  }
  if (senses.has("smell")) {
    facets.push({
      sense: "smell",
      label: placedLabel(SYSTEM_SAFETY_NOTES.burningSmellReported, subjects),
      subjects,
    })
  }
  if (facets.length === 0) return { kind: "unsure" }
  return { kind: "facets", facets }
}

function defaultElectricalFacets(): SenseFacet[] {
  return [
    { sense: "spark", label: SYSTEM_SAFETY_NOTES.sparksReported, subjects: [] },
    { sense: "smoke", label: SYSTEM_SAFETY_NOTES.smokeReported, subjects: [] },
    { sense: "smell", label: SYSTEM_SAFETY_NOTES.burningSmellReported, subjects: [] },
  ]
}

function facetsForNote(note: string, context: string): SenseFacet[] | "unsure" | null {
  if (sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard)) {
    const split = electricalFacetsFromContext(context)
    return split.kind === "unsure" ? "unsure" : split.facets
  }
  const split = andFacets(note)
  if (split) return split
  if (/\band\b/i.test(note) && sensesOf(note).size >= 2) return "unsure"
  return null
}

function sparkFacetLine(current: string | null | undefined): string | null {
  const notes = trackedConcerns(current)
  if (notes.some((note) => sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard))) return null
  return notes.find((note) => sensesOf(note).size === 1 && sensesOf(note).has("spark")) ?? null
}

function stoppedElectricalSenses(sentence: string): Set<ConcernSense> {
  const stopped = new Set<ConcernSense>()
  if (/\b(?:stopped sparking|not sparking|no longer sparking|isn'?t sparking|is not sparking|sparks? (?:have |has )?stopped|sparking (?:has |have )?stopped|no more sparks)\b/i.test(sentence)) {
    stopped.add("spark")
  }
  if (/\b(?:smoke (?:has |have )?stopped|no more smoke|smoke is gone)\b/i.test(sentence)) {
    stopped.add("smoke")
  }
  if (/\b(?:burning smell (?:has |have )?stopped|(?:the )?smell is gone|no more smell|smell (?:has |have )?stopped)\b/i.test(sentence)) {
    stopped.add("smell")
  }
  return stopped
}

function electricalStopIsPartial(sentence: string, context: string): boolean {
  const split = electricalFacetsFromContext(context)
  if (split.kind === "unsure") return true
  const stopped = stoppedElectricalSenses(sentence)
  if (stopped.size === 0) return false
  return split.facets.some((facet) => !stopped.has(facet.sense))
}

function dropActiveNote(
  current: string | null | undefined,
  note: string,
): string | undefined {
  const parsed = parseSafetyNotes(current)
  const active = parsed.active.filter((item) => !sameConcern(item, note))
  return formatSafetyNotes(active, parsed.resolved)
}

function dropRedundantElectricalTemplate(
  current: string | null | undefined,
): string | undefined {
  const active = openConcerns(current)
  if (!active.some((note) => sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard))) {
    return current?.trim() || undefined
  }
  const separated = active.some((note) =>
    /^sparks reported\b/i.test(note) ||
    /^smoke reported\b/i.test(note) ||
    /^burning smell reported\b/i.test(note) ||
    (sensesOf(note).size === 1 && sensesOf(note).has("spark"))
  )
  const custom = active.some((note) =>
    andFacets(note)?.some((facet) =>
      facet.sense === "spark" || facet.sense === "smell" || facet.sense === "smoke"
    )
  )
  if (!separated && !custom) return current?.trim() || undefined
  return dropActiveNote(current, SYSTEM_SAFETY_NOTES.electricalHazard)
}

function retireFacet(current: string | null | undefined, label: string): string | undefined {
  return resolveSafetyNote(upsertActiveSafetyNote(current, label), label)
}

function replaceCombinedNote(
  current: string | null | undefined,
  note: string,
  keep: SenseFacet[],
  stop: SenseFacet[],
): string | undefined {
  if (keep.length === 0) return resolveSafetyNote(current, note)
  let next = dropActiveNote(current, note)
  for (const facet of keep) next = upsertActiveSafetyNote(next, facet.label)
  for (const facet of stop) next = retireFacet(next, facet.label)
  return next
}

function subjectsOf(clause: string): string[] {
  return contentTokens(clause).filter((token) => !SENSE_WORDS.has(token) && !SENSE_WORDS.has(stemToken(token)))
}

function sharesSubject(note: string, subjects: string[]): boolean {
  if (subjects.length === 0) return false
  const tokens = contentTokens(note)
  return subjects.some((subject) => tokens.some((token) => sameToken(token, subject)))
}

function clauseHasStatus(text: string): boolean {
  return warmthStopped(text) ||
    smellStopped(text) ||
    sparkStopped(text) ||
    noiseStopped(text) ||
    leakDripStopped(text) ||
    overflowStopped(text) ||
    doorStopped(text) ||
    illnessEased(text) ||
    collapseStopped(text) ||
    structuralWaterStopped(text) ||
    homeSecured(text) ||
    coldEased(text) ||
    replySaysStill(text) ||
    negatedStatus(text)
}

function splitStatusClauses(text: string): string[] {
  const parts = text
    .split(/\s*(?:,|\b(?:but|although|though)\b|(?<=[.!?]))\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
  const clauses = (parts.length > 0 ? parts : [text]).flatMap((part) => {
    const sides = part.split(/\s+\band\b\s+/i).map((side) => side.trim()).filter(Boolean)
    if (sides.length >= 2 && sides.every((side) => clauseHasStatus(side))) return sides
    return [part]
  })
  return clauses.length > 0 ? clauses : [text]
}

function warmthStopped(text: string): boolean {
  if (/\b(?:not|never|hasn'?t|have not|isn'?t|is not|won'?t|will not|didn'?t|did not)\s+(?:yet\s+)?(?:cooled|cool(?:ed)?\s+down)\b/i.test(text)) {
    return false
  }
  return /\b(?:cooled(?:\s+(?:down|off))?|has cooled|no longer (?:warm|hot)|not (?:warm|hot) anymore|(?:isn'?t|is not) (?:warm|hot))\b/i.test(text)
}

function smellStopped(text: string): boolean {
  if (replySaysStill(text) && /\b(?:smell|odor|odour|smoke)\b/i.test(text)) return false
  if (/\b(?:smell|odor|odour)\s+(?:isn'?t|is not|hasn'?t|has not)\s+gone\b/i.test(text)) return false
  if (/\b(?:isn'?t|is not|not)\s+gone\b/i.test(text)) return false
  return /\b(?:(?:burning|smoke)\s+)?(?:smell|odor|odour)\s+(?:is\s+|has\s+)?(?:gone|went away|stopped)\b/i.test(text) ||
    /\b(?:no more|no longer any) (?:burning\s+|smoke\s+)?smell\b/i.test(text) ||
    /\b(?:can(?:not|'t)|do not|don't) smell\b/i.test(text) ||
    /\bburning smell (?:has |have )?stopped\b/i.test(text)
}

function sparkStopped(text: string): boolean {
  if (replySaysStill(text) && /\bspark/i.test(text)) return false
  if (/\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:yet\s+)?(?:stopped\s+)?spark/i.test(text)) return false
  return /\b(?:stopped sparking|not sparking|no longer sparking|isn'?t sparking|is not sparking|sparks? (?:have |has )?stopped|sparking (?:has |have )?stopped|no more sparks)\b/i.test(text)
}

function smokeStopped(text: string): boolean {
  if (replySaysStill(text) && /\bsmoke\b/i.test(text)) return false
  if (/\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:stopped\s+)?smoke\b/i.test(text)) return false
  return /\b(?:smoke (?:has |have )?stopped|no more smoke|smoke is gone|no longer any smoke)\b/i.test(text)
}

function noiseStopped(text: string): boolean {
  if (/\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:yet\s+)?(?:stopped\s+)?(?:the\s+)?(?:noise|banging|rattling|grinding)\b/i.test(text)) {
    return false
  }
  if (replySaysStill(text) && /\b(?:noise|bang|banging|rattl|grind)\b/i.test(text)) return false
  return /\b(?:noise|banging|rattling|grinding)\s+(?:has\s+|have\s+)?stopped\b/i.test(text) ||
    /\b(?:stopped|no more|no longer)\s+(?:making\s+)?(?:a\s+)?(?:loud\s+)?(?:noise|banging|rattling|grinding)\b/i.test(text) ||
    /\bthe noise stopped\b/i.test(text)
}

function leakDripStopped(text: string): boolean {
  if (/\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:yet\s+)?(?:stopped\s+)?(?:dripp|leak)/i.test(text)) {
    return false
  }
  if (replySaysStill(text) && /\b(?:dripp|leak)\b/i.test(text)) return false
  return /\b(?:dripp(?:ing)?|leak(?:ing)?)\s+(?:has\s+|have\s+)?stopped\b/i.test(text) ||
    /\b(?:stopped|no longer|no more)\s+(?:dripp(?:ing)?|leak(?:ing)?)\b/i.test(text) ||
    /\bthe dripping stopped\b/i.test(text)
}

function overflowStopped(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\b(?:flooding|overflow(?:ing)?)\s+(?:has\s+)?stopped\b/i.test(text) ||
    /\bstopped\s+overflowing\b/i.test(text) ||
    /\bno longer (?:overflowing|flooding)\b/i.test(text)
}

function doorStopped(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\bdoor is (?:secure|fixed|no longer (?:stuck|hanging))\b/i.test(text) ||
    /\b(?:not hanging anymore|no longer at risk of falling)\b/i.test(text)
}

function illnessEased(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\b(?:feeling better|feels better|no longer (?:dizzy|faint|unwell))\b/i.test(text)
}

function collapseStopped(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\b(?:not sagging anymore|sagging (?:has )?stopped|no longer sagging)\b/i.test(text)
}

function structuralWaterStopped(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\bwater (?:has )?stopped coming through\b/i.test(text) ||
    /\bno longer coming through the (?:ceiling|wall|roof)\b/i.test(text)
}

function homeSecured(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  return /\b(?:can lock (?:it|the door|the home) now|the home is secure now|able to (?:lock|secure) it now)\b/i.test(text)
}

function coldEased(text: string): boolean {
  if (replySaysStill(text) || LEAK_UNCERTAIN.test(text)) return false
  if (/\b(?:hasn'?t|has not|not|never)\s+warmed up\b/i.test(text)) return false
  return /\b(?:warmed up|no longer (?:so )?cold|isn'?t cold anymore)\b/i.test(text)
}

function negatedStatus(text: string): boolean {
  return /\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:yet\s+)?(?:cooled|cool(?:ed)?\s+down|warmed up)\b/i.test(text) ||
    /\b(?:smell|odor|odour)\s+(?:isn'?t|is not|hasn'?t|has not)\s+gone\b/i.test(text) ||
    /\b(?:isn'?t|is not)\s+gone\b/i.test(text) ||
    /\b(?:hasn'?t|have not|isn'?t|is not|not|never)\s+(?:yet\s+)?(?:stopped\s+)?(?:the\s+)?(?:noise|banging|rattling|grinding|dripp(?:ing)?|leak(?:ing)?|spark(?:ing|s)?)\b/i.test(text) ||
    /\b(?:noise|banging|rattling|grinding|dripp(?:ing)?|leak(?:ing)?|spark(?:ing|s)?)\s+(?:hasn'?t|have not|isn'?t|is not|has not)\s+stopped\b/i.test(text)
}

function continuesSense(clause: string, sense: ConcernSense): boolean {
  if (!replySaysStill(clause)) return false
  const senses = sensesOf(clause)
  if (sense === "smell") return senses.has("smell") || senses.has("smoke") || /\b(?:smell|odor|odour)\b/i.test(clause)
  return senses.has(sense)
}

function actionsIn(clause: string): SenseAction[] {
  if (LEAK_UNCERTAIN.test(clause) && !replySaysStill(clause)) return []
  const subjects = subjectsOf(clause)
  const actions: SenseAction[] = []
  const resolve = (sense: ConcernSense, stopped: boolean) => {
    if (continuesSense(clause, sense)) {
      actions.push({ action: "reactivate", sense, subjects })
      return
    }
    if (stopped) actions.push({ action: "resolve", sense, subjects })
  }
  resolve("warmth", warmthStopped(clause))
  resolve("smell", smellStopped(clause))
  resolve("spark", sparkStopped(clause))
  resolve("smoke", smokeStopped(clause))
  resolve("noise", noiseStopped(clause))
  resolve("leak", leakDripStopped(clause))
  resolve("overflow", overflowStopped(clause))
  resolve("door", doorStopped(clause))
  resolve("illness", illnessEased(clause))
  resolve("collapse", collapseStopped(clause))
  resolve("structuralWater", structuralWaterStopped(clause))
  resolve("secure", homeSecured(clause))
  resolve("cold", coldEased(clause))
  if (/\b(?:warm|hot|overheating)\s+again\b/i.test(clause) || (replySaysStill(clause) && /\b(?:warm|hot)\b/i.test(clause))) {
    actions.push({ action: "reactivate", sense: "warmth", subjects })
  }
  if (
    /\b(?:smell|odor|odour)\s+(?:is\s+)?back\b/i.test(clause) ||
    /\bsmell(?:ing)?\s+(?:it\s+)?again\b/i.test(clause) ||
    /\b(?:smell|odor|odour)\s+(?:is\s+)?(?:still\s+)?(?:here|remains|remaining)\b/i.test(clause)
  ) {
    actions.push({ action: "reactivate", sense: "smell", subjects })
  }
  if (
    (replySaysStill(clause) && /\bspark(?:ing|s|ed)?\b/i.test(clause)) ||
    /\bspark(?:ing|s)?\s+(?:are\s+)?back\b/i.test(clause)
  ) {
    actions.push({ action: "reactivate", sense: "spark", subjects })
  }
  if (
    (replySaysStill(clause) && /\b(?:noise|bang(?:ing)?|rattl(?:e|ing)|grind(?:ing)?)\b/i.test(clause)) ||
    /\b(?:noise|banging|rattling|grinding)\s+(?:is\s+)?back\b/i.test(clause)
  ) {
    actions.push({ action: "reactivate", sense: "noise", subjects })
  }
  if (
    (replySaysStill(clause) && /\b(?:dripp(?:ing)?|leak(?:ing)?)\b/i.test(clause)) ||
    /\b(?:dripp(?:ing)?|leak(?:ing)?)\s+(?:is\s+)?back\b/i.test(clause) ||
    /\b(?:dripping|leaking) again\b/i.test(clause)
  ) {
    actions.push({ action: "reactivate", sense: "leak", subjects })
  }
  return actions
}

const PLACE_SUBJECTS = new Set([
  ...APPLIANCE_SUBJECTS,
  "door", "window", "kitchen", "bathroom", "bedroom", "basement", "garage", "hallway",
  "attic", "closet", "porch", "yard", "ceiling", "wall", "roof", "floor", "home",
])

function locatingSubjects(subjects: string[]): string[] {
  return subjects.filter((subject) => PLACE_SUBJECTS.has(subject))
}

function pickConcerns(
  action: SenseAction,
  notes: string[],
  context: string,
): { kind: "notes"; notes: string[] } | { kind: "ambiguous"; notes: string[] } | { kind: "none" } {
  let sensed = notes.filter((note) => sensesOf(note).has(action.sense))
  if (action.action === "resolve") {
    const onlyThisSense = sensed.filter((note) => sensesOf(note).size === 1)
    if (onlyThisSense.length > 0) sensed = onlyThisSense
  }
  if (sensed.length === 0) return { kind: "none" }
  const places = locatingSubjects(action.subjects)
  if (places.length > 0) {
    const named = sensed.filter((note) => sharesSubject(note, places))
    if (named.length === 1) return { kind: "notes", notes: named }
    if (named.length > 1) return { kind: "ambiguous", notes: named }
    if (sensed.length === 1 && sharesSubject(context, places)) {
      return { kind: "notes", notes: sensed }
    }
    return { kind: "none" }
  }
  if (sensed.length === 1) return { kind: "notes", notes: sensed }
  const narrowed = sensed.filter((note) => sharesSubject(note, subjectsOf(context)))
  if (narrowed.length === 1) return { kind: "notes", notes: narrowed }
  return { kind: "ambiguous", notes: sensed }
}

/**
 * Clear paraphrases, one concern at a time.
 * "Cooled down" can resolve a warm note. "The smell is gone" resolves a smell note.
 * A stored line is only changed when it is one of the notes already saved.
 */
function facetQuestion(note: string, facets: SenseFacet[] | "unsure"): string {
  if (facets === "unsure") {
    const labels = sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard)
      ? defaultElectricalFacets().map((facet) => facet.label)
      : [note]
    return whichConcernQuestion(labels)
  }
  return whichConcernQuestion(facets.map((facet) => facet.label))
}

function applySenseResolution(
  current: string | null | undefined,
  note: string,
  sense: ConcernSense,
  context: string,
): { notes: string | undefined; clarify?: string } | null {
  const facets = facetsForNote(note, context)
  if (facets === "unsure") {
    return { notes: current?.trim() || undefined, clarify: facetQuestion(note, facets) }
  }
  if (!facets) {
    if (!sensesOf(note).has(sense)) return null
    return { notes: resolveSafetyNote(current, note) }
  }
  const stopped = facets.filter((facet) => facet.sense === sense)
  if (stopped.length === 0) return null
  if (stopped.length !== 1) {
    return { notes: current?.trim() || undefined, clarify: facetQuestion(note, facets) }
  }
  const keep = facets.filter((facet) => facet.sense !== sense)
  return { notes: replaceCombinedNote(current, note, keep, stopped) }
}

function bothHaveStopped(text: string): boolean {
  return /\bboth\s+(?:have\s+|has\s+)?(?:stopped|are gone|have gone)\b/i.test(text)
}

function applyBothStopped(
  current: string | null | undefined,
  context: string,
): CustomSafetyUpdate {
  const active = openConcerns(current)
  const expanded: Array<{ note: string; facets: SenseFacet[] | null }> = []
  for (const note of active) {
    const facets = facetsForNote(note, context)
    if (facets === "unsure") {
      return { kind: "clarify", question: facetQuestion(note, facets) }
    }
    expanded.push({ note, facets })
  }
  const count = expanded.reduce((sum, item) => sum + (item.facets?.length ?? 1), 0)
  if (count !== 2) {
    const labels = expanded.flatMap((item) => item.facets?.map((facet) => facet.label) ?? [item.note])
    return {
      kind: "clarify",
      question: whichConcernQuestion(labels.length > 0 ? labels : active),
    }
  }
  let notes: string | undefined = current ?? undefined
  for (const item of expanded) {
    notes = resolveSafetyNote(notes, item.note)
  }
  return { kind: "updated", notes }
}

function isSeparableConcern(note: string, context: string): boolean {
  const facets = facetsForNote(note, context)
  return facets === "unsure" || (Array.isArray(facets) && facets.length > 1)
}

/**
 * Clear paraphrases, one concern at a time.
 * A combined line is split when each part can be named. Otherwise the reply
 * is asked about and the line stays active.
 */
function applyMeaningUpdates(
  current: string | null | undefined,
  reply: string,
  context: string,
): CustomSafetyUpdate | null {
  if (bothHaveStopped(reply)) {
    if (LEAK_UNCERTAIN.test(reply) && !replySaysStill(reply)) return { kind: "handled" }
    return applyBothStopped(current, context)
  }
  const clauses = splitStatusClauses(reply)
  const actions = clauses.flatMap((clause) => actionsIn(clause))
  const negatedOnly = actions.length === 0 && clauses.some((clause) => negatedStatus(clause))
  if (actions.length === 0) return negatedOnly ? { kind: "handled" } : null

  let notes = dropRedundantElectricalTemplate(current)
  let changed = false
  let matched = false
  let ambiguous: string[] | null = null
  let clarifyQuestion: string | null = null
  const reactivated = new Set<string>()
  const allowed = new Set(trackedConcerns(current).map((note) => note.trim().toLowerCase()))
  const remember = (value: string | null | undefined) => {
    for (const note of trackedConcerns(value)) allowed.add(note.trim().toLowerCase())
  }
  remember(notes)
  const reopen = actions.filter((action) => action.action === "reactivate")
  const resolve = actions.filter((action) => action.action === "resolve")

  for (const action of reopen) {
    const pool = trackedConcerns(notes).filter((note) => allowed.has(note.trim().toLowerCase()))
    const picked = pickConcerns(action, pool, context)
    if (picked.kind === "ambiguous") ambiguous = picked.notes
    if (picked.kind !== "notes") continue
    matched = true
    for (const note of picked.notes) {
      const next = upsertActiveSafetyNote(notes, note)
      if ((next ?? "").trim() !== (notes ?? "").trim()) changed = true
      notes = next
      remember(notes)
      reactivated.add(`${note.trim().toLowerCase()}::${action.sense}`)
    }
  }
  for (const action of resolve) {
    const pool = openConcerns(notes).filter((note) => allowed.has(note.trim().toLowerCase()))
    const picked = pickConcerns(action, pool, context)
    if (picked.kind === "ambiguous") ambiguous = picked.notes
    if (picked.kind !== "notes") continue
    matched = true
    for (const note of picked.notes) {
      if (reactivated.has(`${note.trim().toLowerCase()}::${action.sense}`)) continue
      const applied = applySenseResolution(notes, note, action.sense, context)
      if (!applied) continue
      if (applied.clarify) {
        clarifyQuestion = applied.clarify
        continue
      }
      if ((applied.notes ?? "").trim() !== (notes ?? "").trim()) changed = true
      notes = applied.notes
      remember(notes)
    }
  }

  if (!changed && clarifyQuestion) return { kind: "clarify", question: clarifyQuestion }
  if (!changed && ambiguous && ambiguous.length > 1) {
    return { kind: "clarify", question: whichConcernQuestion(ambiguous) }
  }
  if (changed) return { kind: "updated", notes }
  if (negatedOnly || matched) return { kind: "handled" }
  return null
}

/**
 * Update one saved note from shared words or a clear paraphrase.
 * A bare "it stopped" uses the only active note, or asks which one.
 * Resident text is matched as a status update. It is not followed as an instruction.
 */
function interpretCustomSafetyReply(
  current: string | null | undefined,
  reply: string,
  context = "",
): CustomSafetyUpdate {
  const text = reply.replace(/\s+/g, " ").trim()
  if (!text) return { kind: "unchanged" }
  if (
    (/\b(?:ignore|disregard)\b/i.test(text) && /\b(?:notes|concerns|instructions)\b/i.test(text)) ||
    /\b(?:mark|resolve|clear|close)\s+(?:everything|all|every)\b/i.test(text)
  ) {
    return { kind: "handled" }
  }
  const active = openConcerns(current)
  const matches = bestNoteMatches(trackedConcerns(current), text)
  const uncertain = LEAK_UNCERTAIN.test(text)
  const still = replySaysStill(text)
  const unique = matches.length === 1 ? matches[0] : null
  const stop = hasClearStop(text) || (unique != null && deniesMatchedWord(text, unique))

  if (uncertain && !still) {
    if (matches.length > 0 || isBareStop(text) || actionsIn(text).length > 0 || uncertainStatusOnly(text)) {
      return { kind: "handled" }
    }
    return { kind: "unchanged" }
  }

  let meaning: CustomSafetyUpdate | null = null
  try {
    meaning = applyMeaningUpdates(current, text, context)
  } catch {
    meaning = null
  }
  if (meaning) return meaning

  if (isBareStop(text) && matches.length === 0) {
    if (active.length > 1) return { kind: "clarify", question: whichConcernQuestion(active) }
    if (active.length === 1 && isSeparableConcern(active[0], context)) {
      return { kind: "clarify", question: facetQuestion(active[0], facetsForNote(active[0], context) ?? "unsure") }
    }
    if (active.length === 1) return { kind: "updated", notes: resolveSafetyNote(current, active[0]) }
    return { kind: "unchanged" }
  }

  if (matches.length > 1 && (stop || still)) {
    const activeMatches = matches.filter((note) => active.some((item) => sameConcern(item, note)))
    const choices = activeMatches.length > 0 ? activeMatches : matches
    if (choices.length > 1) return { kind: "clarify", question: whichConcernQuestion(choices) }
    if (choices.length === 1 && stop && !still && !isSeparableConcern(choices[0], context)) {
      return { kind: "updated", notes: resolveSafetyNote(current, choices[0]) }
    }
    if (choices.length === 1 && still) {
      return { kind: "updated", notes: upsertActiveSafetyNote(current, choices[0]) }
    }
  }

  if (unique && stop && !still && !isSeparableConcern(unique, context)) {
    return { kind: "updated", notes: resolveSafetyNote(current, unique) }
  }
  if (unique && still) return { kind: "updated", notes: upsertActiveSafetyNote(current, unique) }
  return { kind: "unchanged" }
}

function withApplianceLeakNote(
  current: string | null | undefined,
  text: string,
  state?: SmsIntakeState,
): string | undefined {
  const predefined = applyReportedSafetyUpdates(current, text, state)
  const prior = leakSentences(text).slice(0, -1).join(" ")
  const custom = interpretCustomSafetyReply(predefined, latestSentence(text), prior)
  if (custom.kind === "updated") return custom.notes
  return predefined
}

function appendTenantUpdate(description: string | undefined, answer: string): string {
  return [description?.trim(), `${TENANT_UPDATE_PREFIX} ${answer}`].filter(Boolean).join("\n")
}

function chooseCombinedFacet(
  current: string | null | undefined,
  answer: string,
  context: string,
): CustomSafetyUpdate | null {
  const active = openConcerns(current)
  if (active.length !== 1) return null
  const note = active[0]
  const known = sameConcern(note, SYSTEM_SAFETY_NOTES.electricalHazard)
    ? defaultElectricalFacets()
    : facetsForNote(note, context)
  const facets = known === "unsure" ? andFacets(note) : known
  if (!facets || facets.length < 2) return null
  const bare = answer.replace(/[.!]+$/g, "").trim()
  if (splitStatusClauses(bare).length > 1) return null
  const namedSenses = new Set(facets.filter((facet) => sensesOf(bare).has(facet.sense)).map((facet) => facet.sense))
  if (namedSenses.size > 1) return null
  const numbered = bare.match(/^(\d+)\b/)
  const chosen = numbered
    ? facets[Number(numbered[1]) - 1]
    : facets.filter((facet) => sensesOf(bare).has(facet.sense)).length === 1
      ? facets.filter((facet) => sensesOf(bare).has(facet.sense))[0]
      : undefined
  if (!chosen) {
    if (numbered) return { kind: "clarify", question: whichConcernQuestion(facets.map((facet) => facet.label)) }
    return null
  }
  return {
    kind: "updated",
    notes: replaceCombinedNote(
      current,
      note,
      facets.filter((facet) => facet.sense !== chosen.sense),
      [chosen],
    ),
  }
}

function applySafetyStatusChoice(state: SmsIntakeState, answer: string): SmsIntakeState {
  const active = openConcerns(state.safety_concerns)
  const bare = answer.replace(/[.!]+$/g, "").trim()
  const facetChoice = chooseCombinedFacet(state.safety_concerns, bare, tenantAuthoredText(state))
  if (facetChoice?.kind === "updated") {
    return applyQuestionPlan({
      ...state,
      safety_concerns: facetChoice.notes,
      description: appendTenantUpdate(state.description, answer),
      diagnostic_question_type: undefined,
      diagnostic_question: undefined,
    })
  }
  if (active.length === 0 || /^(?:none|no|n\/a|nothing|nope|nah)$/i.test(bare)) {
    return applyQuestionPlan({
      ...state,
      description: appendTenantUpdate(state.description, answer),
      diagnostic_question_type: undefined,
      diagnostic_question: undefined,
    })
  }
  const numbered = bare.match(/^(\d+)\b/)
  if (!numbered) {
    const interpreted = interpretCustomSafetyReply(
      state.safety_concerns,
      answer,
      tenantAuthoredText(state),
    )
    if (interpreted.kind === "updated") {
      return applyQuestionPlan({
        ...state,
        safety_concerns: interpreted.notes,
        description: appendTenantUpdate(state.description, answer),
        diagnostic_question_type: undefined,
        diagnostic_question: undefined,
      })
    }
    if (interpreted.kind === "clarify") {
      return {
        ...state,
        step: "diagnostic",
        diagnostic_question_type: "safety_concern_status",
        diagnostic_question: interpreted.question,
      }
    }
  }
  const picked = numbered ? active[Number(numbered[1]) - 1] : undefined
  const matches = picked ? [picked] : bestNoteMatches(active, answer)
  if (matches.length === 1) {
    return applyQuestionPlan({
      ...state,
      safety_concerns: resolveSafetyNote(state.safety_concerns, matches[0]),
      description: appendTenantUpdate(state.description, answer),
      diagnostic_question_type: undefined,
      diagnostic_question: undefined,
    })
  }
  return {
    ...state,
    step: "diagnostic",
    diagnostic_question_type: "safety_concern_status",
    diagnostic_question: whichConcernQuestion(active),
  }
}

/**
 * Add a safety-concerns reply without erasing notes already stored.
 * "None" keeps existing active and resolved lines.
 */
export function mergeSafetyConcernAnswer(
  current: string | null | undefined,
  answer: string,
): string | undefined {
  const trimmed = answer.replace(/\s+/g, " ").trim()
  if (!trimmed) {
    const kept = (current ?? "").trim()
    return kept || undefined
  }
  const bare = trimmed.replace(/[.!]+$/g, "")
  if (/^(?:none|no|n\/a|nothing|nope|nah)$/i.test(bare)) {
    const kept = (current ?? "").trim()
    return kept || SYSTEM_SAFETY_NOTES.noneReported
  }
  const updated = applyReportedSafetyUpdates(current, trimmed)
  const custom = interpretCustomSafetyReply(updated, trimmed, current ?? "")
  if (custom.kind === "updated") return custom.notes
  if (custom.kind === "handled" || custom.kind === "clarify") return updated
  if (answerIsKnownConcern(trimmed)) return updated
  if (uncertainStatusOnly(trimmed)) return updated
  return upsertActiveSafetyNote(updated, trimmed)
}

/** Add one safety note without dropping a different concern already stored. */
function setSafetyNote(
  current: string | null | undefined,
  note: string,
  drop: readonly string[] = [],
): string {
  const dropKeys = new Set(drop.map((item) => item.toLowerCase()))
  if (dropKeys.size === 0) return upsertActiveSafetyNote(current, note)
  const parsed = parseSafetyNotes(current)
  const active = parsed.active.filter((item) => !dropKeys.has(item.toLowerCase()))
  const resolved = parsed.resolved.filter((item) => !dropKeys.has(item.toLowerCase()))
  return upsertActiveSafetyNote(formatSafetyNotes(active, resolved), note)
}

function namedAppliance(text: string): { kind: NamedAppliance; label: string } | null {
  const match = text.match(APPLIANCE_MENTION)
  const word = match?.[1]?.toLowerCase()
  if (!word) return null
  if (word === "freezer") return { kind: "freezer", label: "freezer" }
  if (word === "dishwasher") return { kind: "dishwasher", label: "dishwasher" }
  if (word === "washing machine") return { kind: "washer", label: "washing machine" }
  if (word === "washer") return { kind: "washer", label: "washer" }
  if (word === "dryer") return { kind: "dryer", label: "dryer" }
  if (word === "microwave") return { kind: "microwave", label: "microwave" }
  if (word === "oven") return { kind: "oven", label: "oven" }
  if (word === "stove") return { kind: "stove", label: "stove" }
  if (word === "refrigerator") return { kind: "fridge", label: "refrigerator" }
  return { kind: "fridge", label: "fridge" }
}

function symptomQuestionFor(kind: NamedAppliance, label: string): string {
  switch (kind) {
    case "freezer":
      return "Is your freezer not cooling, building up frost, not running, or doing something else?"
    case "fridge":
      return `Is your ${label} not cooling, leaking, making a loud noise, or doing something else?`
    case "washer":
      return `Is your ${label} not starting, not draining, leaking, making a loud noise, or is the door stuck?`
    case "dryer":
      return `Is your ${label} not heating, not tumbling, making a loud noise, or doing something else?`
    case "dishwasher":
      return `Is your ${label} not starting, not draining, leaking, or doing something else?`
    case "oven":
      return `Is your ${label} not heating, not turning on, or doing something else?`
    case "stove":
      return `Is your ${label} not heating, not lighting, or doing something else?`
    case "microwave":
      return `Is your ${label} not heating, not starting, sparking, or doing something else?`
  }
}

/**
 * Symptom question for this appliance, or null when it should not be asked.
 * Null covers a non-appliance, water already on the floor, and a symptom
 * the resident already stated. "Broken" still needs the question.
 */
export function applianceSymptomQuestion(input: {
  tenantText: string
  categoryText?: string
}): string | null {
  const text = input.tenantText.replace(/\s+/g, " ").trim()
  const category = (input.categoryText ?? "").toLowerCase()
  const named = namedAppliance(text)
  const appliance = named != null || category.includes("appliance")
  if (!appliance) return null
  // Water on the floor stays its own skip. A plain "it's leaking" is a known
  // symptom and also skips, but it is not treated as water on the floor.
  if (APPLIANCE_WATER_ON_FLOOR.test(text)) return null
  if (reportsActiveApplianceLeak(text)) return null
  if (STATED_APPLIANCE_SYMPTOM.test(text)) return null
  if (!named) return GENERIC_APPLIANCE_SYMPTOM_QUESTION
  return symptomQuestionFor(named.kind, named.label)
}

function isPest(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("pest") ||
    /\b(roach|roach(?:es)?|mouse|mice|rat|bug|ant|bedbug|exterminator|spray(?:ing)? the (?:property|unit))\b/
      .test(hay)
}

/** True when the tenant described a crack, sagging ceiling, or a hole — not merely “ceiling” or “crack” as a side word. */
function reportsStructuralDamage(hay: string): boolean {
  if (
    /\b(sagging\s+ceiling|ceiling\s+(?:is\s+)?(?:sagging|dropping|bowing)|(?:sagging|bowing|dropping)\s+ceiling)\b/
      .test(hay)
  ) {
    return true
  }
  if (/\bhole\s+in(?:\s+(?:the|my|a|\w+)){0,3}\s+(?:wall|ceiling|floor)\b/.test(hay)) {
    return true
  }
  if (
    /\b(?:wall|ceiling|floor|foundation|drywall).{0,24}\bcrack/.test(hay) ||
    /\bcrack.{0,24}\b(?:wall|ceiling|floor|foundation|drywall)/.test(hay)
  ) {
    return true
  }
  if (/\bstructural\s+(?:crack|damage|issue)\b/.test(hay)) return true
  return false
}

function shouldAskStructuralRisk(state: SmsIntakeState, hay: string): boolean {
  if (!reportsStructuralDamage(hay)) return false
  if (isPest(state, hay) || isElectrical(state, hay) || isHvac(state, hay) || isLock(state, hay)) {
    return false
  }
  if (isDoorComplaint(state, hay)) return false
  if (isPlumbing(state, hay) && !/\b(crack|sag|hole in)\b/.test(hay)) return false
  if (isAppliance(state, hay)) return false
  return true
}

function isLock(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("lock") || /\b(won'?t lock|can'?t lock|locked out|deadbolt)\b/.test(hay)
}

function isCabinetOrApplianceDoor(hay: string): boolean {
  return /\b(cabinet|cupboard|pantry|dishwasher|fridge|refrigerator|oven|stove|microwave|washer|dryer|freezer)\b/
    .test(hay)
}

function mentionsEntryDoor(hay: string): boolean {
  return /\bdoors?\b/.test(hay) && !isCabinetOrApplianceDoor(hay)
}

function doorDamageLanguage(hay: string): boolean {
  return /\b(broke|broken|damaged|jammed|won'?t\s+(?:close|open|lock|shut)|will\s+not\s+(?:close|open|lock|shut)|off\s+(?:the\s+)?hinges?)\b/
    .test(hay)
}

function pendingDoorText(state: SmsIntakeState): string | null {
  const bits = (state.pending_issues ?? [])
    .map((i) => `${i.description} ${i.summary} ${i.vendor_trade} ${i.issue_type}`)
    .filter((blob) => {
      const t = blob.toLowerCase()
      return mentionsEntryDoor(t) && !isCabinetOrApplianceDoor(t)
    })
  if (!bits.length) return null
  const facts = state.diagnostic_facts ?? {}
  return `${bits.join(" ")} ${facts.door_part ?? ""} ${facts.door_safety ?? ""} ${facts.lock_secure ?? ""}`
    .toLowerCase()
}

function doorHay(state: SmsIntakeState, hay: string): string {
  return pendingDoorText(state) ?? hay
}

function isDoorComplaint(state: SmsIntakeState, hay: string): boolean {
  const scoped = doorHay(state, hay)
  if (!mentionsEntryDoor(scoped)) return false
  if (
    isAppliance(state, hay) &&
    isCabinetOrApplianceDoor(hay) &&
    !pendingDoorText(state)
  ) {
    return false
  }
  if (doorDamageLanguage(scoped)) return true
  const pendingCat = (state.pending_issues ?? [])
    .map((i) => `${i.vendor_trade} ${i.issue_type}`)
    .join(" ")
    .toLowerCase()
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? pendingCat)
    .toLowerCase()
  return cat.includes("lock") || cat.includes("carpent") || cat.includes("window")
}

function isDoorLockHardware(hay: string): boolean {
  return /\b(locks?|deadbolt|handle|knob|latch|doorknob)\b/.test(hay)
}

function isDoorStructurePart(hay: string): boolean {
  return /\b(frame|hinges?|slab|panel|door itself)\b/.test(hay)
}

function namedDoorPart(hay: string): boolean {
  return isDoorLockHardware(hay) ||
    /\b(frame|hinges?|slab|panel|door itself)\b/.test(hay)
}

function doorSafetyAlreadyKnown(hay: string): boolean {
  return /\b(stuck|hanging|off\s+(?:the\s+)?hinges?|falling|could fall|about to fall|loose)\b/
    .test(hay)
}

function shouldAskDoorPart(state: SmsIntakeState, hay: string): boolean {
  const scoped = doorHay(state, hay)
  return isDoorComplaint(state, hay) && !namedDoorPart(scoped)
}

function doorFollowUpsPending(state: SmsIntakeState, hay: string): boolean {
  if (!isDoorComplaint(state, hay)) return false
  const scoped = doorHay(state, hay)
  if (shouldAskDoorPart(state, hay) && !asked(state, "door_part")) return true
  if (isDoorLockHardware(scoped) && !asked(state, "lock_secure")) return true
  if (
    !isDoorLockHardware(scoped) &&
    !doorSafetyAlreadyKnown(scoped) &&
    (isDoorStructurePart(scoped) || asked(state, "door_part")) &&
    !asked(state, "door_safety")
  ) {
    return true
  }
  return false
}

function knownOverflow(state: SmsIntakeState, hay: string): boolean | null {
  const stored = fact(state, "plumbing_overflow") || fact(state, "toilet_overflow")
  if (stored) {
    const reading = readWaterFlowAnswer(stored)
    if (reading === "uncontrolled") return true
    if (reading === "contained") return false
  }
  if (/\b(?:no|not|without)\s+(?:an?\s+)?(?:active\s+)?overflow(?:ing)?\b/.test(hay)) return false
  if (/\b(overflow(?:ing)?|pouring|gushing|flooding|water everywhere)\b/.test(hay)) return true
  return null
}

function knownActiveFlow(state: SmsIntakeState, hay: string): boolean | null {
  const stored = fact(state, "plumbing_active_flow")
  if (stored) {
    const reading = readWaterFlowAnswer(stored)
    if (reading === "uncontrolled") return true
    if (reading === "contained") return false
  }
  if (/\b(pouring|gushing|still (?:leaking|flowing)|actively leaking)\b/.test(hay)) return true
  return null
}

function alreadyHazard(hay: string): boolean {
  return /\b(spark|sparks|smoke|burning smell|gas smell|exposed (?:live )?wire|electrical fire)\b/
    .test(hay)
}

function questionBudget(state: SmsIntakeState, hay: string): number {
  const low = state.confidence_band === "low" ||
    (state.classification_confidence != null && state.classification_confidence < 0.45)
  const safety = alreadyHazard(hay) || knownOverflow(state, hay) === true ||
    knownActiveFlow(state, hay) === true || isLock(state, hay) ||
    isDoorComplaint(state, hay)
  if (safety || low || (state.pending_issues?.length ?? 0) >= 2) return 3
  return 2
}

function answeredCount(state: SmsIntakeState): number {
  return (state.asked_question_types ?? []).filter((t) => t !== "photo").length
}

function photoQuestion(state: SmsIntakeState, hay: string): NextMaintenanceQuestion {
  if (isElectrical(state, hay) || /\b(gas|spark|smoke|fire)\b/.test(hay)) {
    return { shouldAsk: false }
  }
  let question =
    "If it's safe to do so, send a photo of the area. If you'd rather not, reply SKIP."
  if (/\b(sink|drain|clog)\b/.test(hay)) {
    question =
      "Thanks. If you can, send me a photo of the sink/drain. It can help the property team or plumber understand what they're dealing with. If you'd rather not, reply SKIP."
  } else if (isAppliance(state, hay)) {
    question =
      "If you can, send a photo or short video showing what happens when you try to use it. If you'd rather not, reply SKIP."
  } else if (isPest(state, hay)) {
    question =
      "If you can, send a photo of what you saw. If you'd rather not, reply SKIP."
  } else if (isDoorComplaint(state, hay)) {
    question =
      "If you can, send a photo of the door so the property team can see the damage. If you'd rather not, reply SKIP."
  } else if (reportsStructuralDamage(hay)) {
    question = "If it's safe to do so, send a photo of the area. If you'd rather not, reply SKIP."
  }
  return {
    shouldAsk: true,
    questionType: "photo",
    question,
    step: "photo",
  }
}

function itemDetailFollowUp(state: SmsIntakeState): string | null {
  if (asked(state, "item_detail") || fact(state, "item_detail")) return null
  if (locationFollowUp(state)) return null
  return itemDetailQuestion(tenantAuthoredText(state))
}

function locationFollowUp(state: SmsIntakeState): string | null {
  const stored = state.room_or_area?.trim()
  if (stored) {
    const onItsOwn = clarifyIssueLocation({
      text: stored,
      bedroomCount: state.property_bedroom_count,
      bathroomCount: state.property_bathroom_count,
    })
    if (!onItsOwn.question) return null
  }
  const result = clarifyIssueLocation({
    text: [tenantAuthoredText(state), stored].filter(Boolean).join(" "),
    bedroomCount: state.property_bedroom_count,
    bathroomCount: state.property_bathroom_count,
  })
  return result.question
}

function readyForSelfFix(state: SmsIntakeState, hay: string): boolean {
  const issueKnown = Boolean(state.issue_type || state.vendor_trade || state.primary_category)
  if (!issueKnown) return false
  if (state.room_or_area?.trim()) return true
  if (isHvac(state, hay) || isLock(state, hay)) return true
  return asked(state, "room_or_area")
}

export function determineNextMaintenanceQuestion(
  state: SmsIntakeState,
): NextMaintenanceQuestion {
  return withInterpretationConfirmation(
    state,
    resolveNextMaintenanceQuestion(state),
  )
}

/**
 * When the recognizer was only half sure what the resident meant, say the
 * reading out loud in the first question rather than asking what they need.
 */
function withInterpretationConfirmation(
  state: SmsIntakeState,
  next: NextMaintenanceQuestion,
): NextMaintenanceQuestion {
  if (!next.shouldAsk) return next
  if ((state.asked_question_types?.length ?? 0) > 0) return next
  if (next.questionType === "symptom_clarify") return next

  // Only what the resident typed. Reading our own safety notes back through
  // the recognizer is what produced the sink-overflow artifact.
  const seed = stripSystemIntakeText(
    (state.description ?? state.initial_message ?? "").trim(),
  )
  if (!seed) return next

  const confirmation = recognizeInboundIntentSync(seed).confirmation
  if (!confirmation) return next
  return { ...next, question: `${confirmation}\n\n${next.question}` }
}

function resolveNextMaintenanceQuestion(
  state: SmsIntakeState,
): NextMaintenanceQuestion {
  const hay = haystack(state)
  // Category matching reads the resident's words only. `hay` still carries
  // our safety notes, which other branches and urgency depend on.
  const tenantHay = tenantAuthoredText(state).toLowerCase()
  const room = resolveRoomLabel(state)
  const budget = questionBudget(state, hay)
  const answered = answeredCount(state)

  if (state.step === "classification_clarification" && state.clarification_question?.trim()) {
    return {
      shouldAsk: true,
      questionType: "classification_clarification",
      question: state.clarification_question.trim(),
      step: "classification_clarification",
    }
  }

  // Never confirm a clarify-menu echo (“A repair”) or other vague seed as the ticket.
  const vagueSeed =
    isVagueTicketDescription(state.initial_message ?? "") ||
    isVagueTicketDescription(state.description ?? "") ||
    (
      !inferIssueTypeFromText(
        [state.initial_message, state.description].filter(Boolean).join(" "),
      ) &&
      looksLikeBareRepairRequest(state.initial_message ?? "")
    )
  if (vagueSeed && !asked(state, "symptom_clarify")) {
    return {
      shouldAsk: true,
      questionType: "symptom_clarify",
      question: VAGUE_MAINTENANCE_QUESTION,
      step: "diagnostic",
    }
  }

  // Heat distress is already an emergency. Do not keep troubleshooting.
  if (
    fact(state, "hvac_immediate_danger") === "yes" ||
    (isHvac(state, hay) && indicatesImmediateHeatDanger(tenantAuthoredText(state)))
  ) {
    return { shouldAsk: false }
  }

  const overBudget = answered >= budget
  const door = doorHay(state, hay)

  const tryAsk = (
    type: MaintenanceQuestionType,
    question: string,
    step: IntakeStep = "diagnostic",
  ): NextMaintenanceQuestion | null => {
    if (asked(state, type)) return null
    const safetyFollowUp = type === "lock_secure" || type === "door_safety" ||
      type === "door_part" || type === "electrical_hazard" ||
      type === "structural_risk" || type === "plumbing_active_flow" ||
      type === "hvac_dangerous_temp" || type === "hvac_heat_check" || type === "unit_entry"
    if (overBudget && !safetyFollowUp) return null
    return { shouldAsk: true, questionType: type, question, step }
  }

  if (
    isPlumbing(state, hay) &&
    knownOverflow(state, hay) !== false &&
    /\b(pouring|gushing|under (?:the )?sink)\b/.test(hay) &&
    !/\bno active leak\b/.test(hay)
  ) {
    const q = tryAsk(
      "plumbing_active_flow",
      "Is the water still actively flowing? If you can safely reach the shutoff valve under the sink, turn it clockwise to stop the water. If you can't safely do that, move away from the area.",
    )
    if (q) return q
  }

  // Vague fixture flooding ("My sink is flooded") — confirm active flow + shutoff
  // before photo / emergency escalation.
  if (
    isPlumbing(state, hay) &&
    /\b(sink|tub|bathtub|basin)\b/.test(hay) &&
    /\b(flood(?:ed|ing))\b/.test(hay) &&
    knownActiveFlow(state, hay) == null &&
    knownOverflow(state, hay) !== false &&
    !/\bno active leak\b/.test(hay)
  ) {
    const q = tryAsk(
      "plumbing_active_flow",
      "Is the water still actively flowing? If you can safely reach the shutoff valve under the sink, turn it clockwise to stop the water. If you can't safely do that, move away from the area.",
    )
    if (q) return q
  }

  if (
    isPlumbing(state, hay) &&
    /\btoilet\b/.test(hay) &&
    /\b(?:clog|backup|won'?t (?:flush|go down))\b/.test(hay)
  ) {
    if (knownOverflow(state, hay) == null) {
      const q = tryAsk("toilet_overflow", "Got it. Is the toilet overflowing right now?")
      if (q) return q
    }
    if (knownOverflow(state, hay) === true || /\bclog\b/.test(hay)) {
      const q = tryAsk(
        "toilet_only",
        "Is this the only working toilet in the home?",
      )
      if (q) return q
    }
  }

  if (
    isPlumbing(state, hay) &&
    /\b(clog|clogged|backup)\b/.test(hay) &&
    /\bsink\b/.test(hay) &&
    knownOverflow(state, hay) == null
  ) {
    const q = tryAsk("plumbing_overflow", "Got it. Is the sink overflowing or leaking water right now?")
    if (q) return q
  }

  // No water at all is its own problem — never ask hot-water questions for it.
  if (isPlumbing(state, hay) && matchesWaterOutage(tenantHay)) {
    const q = tryAsk(
      "plumbing_water_outage_scope",
      "Is the water out everywhere in the home, or just at one sink or shower?",
    )
    if (q) return q
    if (!state.first_noticed?.trim() && parseDurationHours(hay) == null) {
      const duration = tryAsk(
        "duration_material",
        "Has the water been out for more than a day, or did this just start?",
      )
      if (duration) return duration
    }
  }

  if (
    isPlumbing(state, hay) &&
    !matchesWaterOutage(tenantHay) &&
    /\b(?:no hot water|no heat(?:ed)? water)\b/.test(hay)
  ) {
    const q = tryAsk(
      "plumbing_hot_water_scope",
      "Is there no hot water anywhere in the home, or only at one faucet or shower?",
    )
    if (q) return q
    if (!state.first_noticed?.trim() && parseDurationHours(hay) == null) {
      const duration = tryAsk(
        "duration_material",
        "Has the hot water been out for more than a day, or did this just start?",
      )
      if (duration) return duration
    }
  }

  if (shouldAskStructuralRisk(state, hay)) {
    const q = tryAsk(
      "structural_risk",
      "Is the crack getting larger, sagging, or is there water coming through it?",
    )
    if (q) return q
  }

  if (
    !isDoorComplaint(state, hay) &&
    !isLock(state, hay) &&
    !isPest(state, hay) &&
    !matchesWaterOutage(tenantHay) &&
    !/\b(?:no hot water|no heat(?:ed)? water)\b/.test(tenantHay)
  ) {
    const place = locationFollowUp(state)
    if (place) {
      const q = tryAsk("room_or_area", place, "room_or_area")
      if (q) return q
    }
  }

  if (
    isPlumbing(state, hay) &&
    /\bleak\b/.test(hay) &&
    !/\bno active leak\b/.test(hay) &&
    knownActiveFlow(state, hay) == null &&
    knownOverflow(state, hay) == null &&
    !/\bclog\b/.test(hay)
  ) {
    const q = tryAsk(
      "plumbing_active_flow",
      "Got it. Is water still actively leaking or overflowing right now?",
    )
    if (q) return q
  }

  if (
    isCoolingFailure(tenantHay) &&
    hotOutdoor(state) &&
    !asked(state, "hvac_heat_check")
  ) {
    const heatQuestion = heatCheckQuestion(tenantHay)
    if (heatQuestion) {
      const q = tryAsk("hvac_heat_check", heatQuestion)
      if (q) return q
    }
  }

  if (isHvac(state, hay) && !fact(state, "hvac_behavior") && !asked(state, "hvac_heat_check") && !knowsAcBehavior(tenantHay)) {
    const q = tryAsk(
      "hvac_behavior",
      "Is the system running but not cooling, or is it not turning on at all? You can say running but warm, no airflow, won't turn on, or not sure.",
    )
    if (q) return q
  }

  if (isHvac(state, hay)) {
    const extreme = (state.outdoor_temp_f != null &&
      (state.outdoor_temp_f >= 88 || state.outdoor_temp_f <= 40)) ||
      /\b(?:no heat|no ac|not cooling|not heating)\b/.test(hay)
    if (
      extreme &&
      !fact(state, "hvac_dangerous_temp") &&
      !asked(state, "hvac_heat_check") &&
      !(hotOutdoor(state) && knowsWellness(tenantHay))
    ) {
      const q = tryAsk(
        "hvac_dangerous_temp",
        "Is the home getting dangerously hot or cold?",
      )
      if (q) return q
    }
  }

  if (isElectrical(state, hay) && !alreadyHazard(hay) &&
    /\b(wire|panel|burning|hot outlet|shock)\b/.test(hay)
  ) {
    const q = tryAsk(
      "electrical_hazard",
      "Do you see sparks, smoke, or smell anything burning?",
    )
    if (q) return q
  }

  const detailQuestion = itemDetailFollowUp(state)
  if (detailQuestion) {
    return {
      shouldAsk: true,
      questionType: "item_detail",
      question: detailQuestion,
      step: "diagnostic",
    }
  }

  if (isElectrical(state, hay) && /\b(outlet|room|bedroom|lights?)\b/.test(hay)) {
    const q = tryAsk(
      "electrical_scope",
      "Is power out only in that room, or in other parts of the home too?",
    )
    if (q) return q
  }

  const symptomQuestion = applianceSymptomQuestion({
    tenantText: tenantAuthoredText(state),
    categoryText: [state.primary_category, state.vendor_trade, state.issue_type]
      .filter(Boolean)
      .join(" "),
  })
  if (symptomQuestion) {
    const q = tryAsk("appliance_symptom", symptomQuestion)
    if (q) return q
  }

  if (isPest(state, hay)) {
    const broadPlace = locationFollowUp(state)
    if (broadPlace && /^Which (?:hallway|closet|stairs)\b/.test(broadPlace)) {
      const q = tryAsk("room_or_area", broadPlace, "room_or_area")
      if (q) return q
    }
    // "Repeatedly" / "again" can mean sighting frequency — only treat as a
    // prior-visit follow-up when a real prior ticket is attached.
    const frequencyImplied =
      Boolean(state.resident_reported_recurring) || detectRecurringIssueSignal(hay)
    const priorVisit = Boolean(state.prior_related_ticket_id?.trim())
    if (!frequencyImplied) {
      const q = tryAsk(
        "pest_frequency",
        "Have you seen just one, or are you seeing them repeatedly?",
      )
      if (q) return q
    }
    if (!room) {
      const loc = tryAsk(
        "pest_location",
        priorVisit
          ? "I see a prior pest visit for your unit. Is this the same spot as last time, or somewhere new?"
          : "Where are you seeing them most — kitchen, bathroom, bedroom, or multiple rooms?",
      )
      if (loc) return loc
    } else if (priorVisit && !asked(state, "pest_location")) {
      const same = tryAsk(
        "pest_location",
        "I see a prior pest visit for your unit. Is this the same issue coming back in that same spot?",
      )
      if (same) return same
    }
  }

  if (shouldAskDoorPart(state, hay)) {
    const q = tryAsk(
      "door_part",
      "What happened to the door, and what part is broken? For example, is it the door itself, the frame, hinges, handle, or lock?",
    )
    if (q) return q
  }

  if (isDoorComplaint(state, hay) && isDoorLockHardware(door)) {
    const q = tryAsk("lock_secure", "Are you currently able to secure the home?")
    if (q) return q
  }

  if (
    isDoorComplaint(state, hay) &&
    !isDoorLockHardware(door) &&
    !doorSafetyAlreadyKnown(door) &&
    (isDoorStructurePart(door) || asked(state, "door_part"))
  ) {
    const q = tryAsk(
      "door_safety",
      "Is the door stuck, hanging loose, or could it fall?",
    )
    if (q) return q
  }

  if (
    isDoorComplaint(state, hay) &&
    (namedDoorPart(door) || asked(state, "door_part")) &&
    !isDoorLockHardware(door) &&
    !room
  ) {
    const q = tryAsk(
      "room_or_area",
      locationFollowUp(state) ??
        "Which room is that door in? Kitchen, bathroom, bedroom, front entrance, or somewhere else?",
      "room_or_area",
    )
    if (q) return q
  }

  if (isLock(state, hay) && !isDoorComplaint(state, hay)) {
    const q = tryAsk("lock_secure", "Are you currently able to secure the home?")
    if (q) return q
  }

  if (!isDoorComplaint(state, hay)) {
    const place = locationFollowUp(state)
    if (place) {
      const q = tryAsk("room_or_area", place, "room_or_area")
      if (q) return q
    }
  }

  if (!state.issue_type && !state.vendor_trade) {
    const q = tryAsk(
      "general_clarify",
      "What are you seeing — a crack, hole, water damage, loose material, or something else?",
    )
    if (q) return q
    const issue = tryAsk(
      "issue_type",
      "Thanks for reaching out. I'll help get this taken care of. What kind of issue is it? Plumbing, electrical, appliance, HVAC, leak, pest, lock, or something else?",
      "issue_type",
    )
    if (issue) return issue
  }

  if (
    readyForSelfFix(state, hay) &&
    !asked(state, "self_fix") &&
    !fact(state, "self_fix_result")
  ) {
    const tip = shouldOfferSelfFix({
      text: hay,
      trade: state.vendor_trade || state.issue_type,
      issueType: state.issue_type,
      outdoorTempF: state.outdoor_temp_f,
      diagnosticFacts: state.diagnostic_facts,
      tipsEnabled: state.self_fix_enabled !== false,
      origin: state.intake_origin,
    })
    if (tip) {
      return {
        shouldAsk: true,
        questionType: "self_fix",
        question: tip.tenantAsk,
        step: "diagnostic",
        tipId: tip.id,
      }
    }
  }

  if (
    !asked(state, "photo") &&
    (state.photo_urls?.length ?? 0) === 0 &&
    isDoorComplaint(state, hay) &&
    !doorFollowUpsPending(state, hay) &&
    (namedDoorPart(door) || asked(state, "door_part") || asked(state, "lock_secure"))
  ) {
    return photoQuestion(state, hay)
  }

  if (
    !asked(state, "photo") &&
    (state.photo_urls?.length ?? 0) === 0 &&
    (asked(state, "plumbing_overflow") || asked(state, "toilet_overflow"))
  ) {
    return photoQuestion(state, hay)
  }

  if (shouldRequestIntakePhoto(state) && !asked(state, "photo")) {
    return photoQuestion(state, hay)
  }

  if (!asked(state, "unit_entry") && !fact(state, "unit_entry")) {
    const q = tryAsk(
      "unit_entry",
      "If you're not home, may staff or a vendor enter the unit to make the repair? Reply YES, NO, or NOT SURE.",
      "diagnostic",
    )
    if (q) return q
  }

  return { shouldAsk: false }
}

export function applyQuestionPlan(state: SmsIntakeState): SmsIntakeState {
  const authored = tenantAuthoredText(state)
  const notes = withApplianceLeakNote(state.safety_concerns, authored, state)
  const prior = leakSentences(authored).slice(0, -1).join(" ")
  const custom = interpretCustomSafetyReply(notes, latestSentence(authored), prior)
  state = { ...state, safety_concerns: notes }
  if (custom.kind === "clarify") {
    const urgency = recommendUrgency(state)
    return {
      ...state,
      recommended_urgency: urgency,
      urgency,
      severity: computeIntakeSeverity({ ...state, urgency }),
      step: "diagnostic",
      diagnostic_question_type: "safety_concern_status",
      diagnostic_question: custom.question,
    }
  }
  const rememberedLocationQuestion = state.location_question?.trim() ||
    (state.diagnostic_question_type === "room_or_area" ? state.diagnostic_question?.trim() : "")
  if (rememberedLocationQuestion) {
    state = { ...state, location_question: rememberedLocationQuestion }
  }
  const locationReading = interpretConfirmedLocation({
    problem: state.initial_message || state.description,
    answer: state.room_or_area,
    question: state.location_question,
  })
  if (locationReading.clarification && state.room_or_area?.trim()) {
    return {
      ...state,
      room_or_area: undefined,
      step: "room_or_area",
      diagnostic_question_type: "room_or_area",
      diagnostic_question: locationReading.clarification,
      location_question: locationReading.clarification,
      asked_question_types: (state.asked_question_types ?? []).filter((type) =>
        type !== "room_or_area"
      ),
    }
  }
  const counts = {
    bedroomCount: state.property_bedroom_count,
    bathroomCount: state.property_bathroom_count,
  }
  const storedPlace = clarifyIssueLocation({
    text: state.room_or_area ?? "",
    ...counts,
  })
  const clarified = clarifyIssueLocation({
    text: [tenantAuthoredText(state), state.room_or_area].filter(Boolean).join(" "),
    ...counts,
  })
  const withLocation: SmsIntakeState =
    storedPlace.location && !storedPlace.question
      ? { ...state, room_or_area: storedPlace.location }
      : clarified.location && !clarified.question
      ? { ...state, room_or_area: clarified.location }
      : state
  const withRecurring = applyRecurringIssueSignal(withLocation)
  const withContact: SmsIntakeState = {
    ...withRecurring,
    preferred_contact_method: withRecurring.preferred_contact_method?.trim() || "text",
  }
  const withPhoto = applyPhotoRequestPolicy(withContact)
  const urgency = recommendUrgency(withPhoto)
  let askedTypes = [...(withPhoto.asked_question_types ?? [])]
  // Recurring language already answers "just one vs repeatedly".
  if (
    withPhoto.resident_reported_recurring &&
    isPest(withPhoto, haystack(withPhoto)) &&
    !askedTypes.includes("pest_frequency")
  ) {
    askedTypes = [...askedTypes, "pest_frequency"]
  }
  const prepared: SmsIntakeState = {
    ...withPhoto,
    asked_question_types: askedTypes,
    recommended_urgency: urgency,
    urgency,
    severity: computeIntakeSeverity({ ...withPhoto, urgency }),
  }
  const next = determineNextMaintenanceQuestion(prepared)
  if (!next.shouldAsk) {
    // Safety net: never land on confirm with a clarify-menu echo as the request.
    if (isVagueTicketDescription([prepared.initial_message, prepared.description].filter(Boolean).join(" "))) {
      return {
        ...prepared,
        step: "diagnostic",
        diagnostic_question_type: "symptom_clarify",
        diagnostic_question: VAGUE_MAINTENANCE_QUESTION,
        asked_question_types: prepared.asked_question_types,
      }
    }
    return {
      ...prepared,
      step: "awaiting_confirm",
      diagnostic_question_type: undefined,
      diagnostic_question: undefined,
    }
  }
  const facts = { ...(prepared.diagnostic_facts ?? {}) }
  if (next.tipId) facts.self_fix_tip = next.tipId
  return {
    ...prepared,
    step: next.step,
    diagnostic_question_type: next.questionType,
    diagnostic_question: next.question,
    location_question: next.questionType === "room_or_area" || next.questionType === "pest_location"
      ? next.question
      : prepared.location_question,
    diagnostic_facts: facts,
  }
}

export function applyDiagnosticAnswer(
  state: SmsIntakeState,
  body: string,
): SmsIntakeState {
  const type = state.diagnostic_question_type || "general_clarify"
  let answer = body.trim()
  if (type === "safety_concern_status") return applySafetyStatusChoice(state, answer)
  const askedTypes = [...(state.asked_question_types ?? [])]
  if (!askedTypes.includes(type)) askedTypes.push(type)

  if (
    type === "plumbing_overflow" ||
    type === "toilet_overflow" ||
    type === "plumbing_active_flow"
  ) {
    const reading = readWaterFlowAnswer(answer)
    const duringWater = interpretCustomSafetyReply(
      state.safety_concerns,
      answer,
      tenantAuthoredText(state),
    )
    const answersSavedConcern = duringWater.kind === "updated" || duringWater.kind === "clarify"
    if ((reading === "ambiguous" || reading === "uncertain") && !answersSavedConcern) {
      const index = askedTypes.indexOf(type)
      if (index >= 0) askedTypes.splice(index, 1)
      return {
        ...state,
        asked_question_types: askedTypes,
        step: "diagnostic",
        diagnostic_question_type: type,
        diagnostic_question: WATER_FLOW_CLARIFICATION,
      }
    }
  }

  const customReply = interpretCustomSafetyReply(
    state.safety_concerns,
    answer,
    tenantAuthoredText(state),
  )
  if (customReply.kind !== "unchanged") {
    const index = askedTypes.indexOf(type)
    if (index >= 0) askedTypes.splice(index, 1)
    const facts = { ...(state.diagnostic_facts ?? {}) }
    delete facts[type]
    return applyQuestionPlan({
      ...state,
      safety_concerns: customReply.kind === "updated" ? customReply.notes : state.safety_concerns,
      description: appendTenantUpdate(state.description, answer),
      diagnostic_facts: facts,
      asked_question_types: askedTypes,
      diagnostic_question_type: undefined,
      diagnostic_question: undefined,
    })
  }

  if (type === "unit_entry" && isUnitEntryNotSure(answer)) {
    answer = "not_sure"
  }

  const facts = { ...(state.diagnostic_facts ?? {}), [type]: answer }
  if (type === "self_fix") {
    const result = classifySelfFixReply(answer)
    facts.self_fix_result = result
    if (result === "not_fixed" && facts.self_fix_tip) {
      facts.self_fix_tried = facts.self_fix_tip
    }
  }
  let safety = state.safety_concerns
  let room = state.room_or_area
  let firstNoticed = state.first_noticed

  let issueType = state.issue_type
  let vendorTrade = state.vendor_trade

  if (type === "plumbing_overflow" || type === "toilet_overflow" || type === "plumbing_active_flow") {
    const reading = readWaterFlowAnswer(answer)
    if (reading === "contained") {
      safety = resolveSafetyNote(safety, SYSTEM_SAFETY_NOTES.overflowYes) ?? safety
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.overflowNo)
    }
    if (reading === "uncontrolled") {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.overflowYes, [SYSTEM_SAFETY_NOTES.overflowNo])
    }
  }
  if (type === "lock_secure") {
    if (isNo(answer)) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.cannotSecure, [SYSTEM_SAFETY_NOTES.canSecure])
    }
    if (isYes(answer)) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.canSecure, [SYSTEM_SAFETY_NOTES.cannotSecure])
    }
  }
  if (type === "door_part") {
    const partHay = answer.toLowerCase()
    if (isDoorLockHardware(partHay)) {
      issueType = "lock"
      vendorTrade = "locksmith"
    } else if (isDoorStructurePart(partHay) || /\b(frame|hinge|door)\b/.test(partHay)) {
      issueType = "general"
      vendorTrade = "carpentry"
    }
  }
  if (type === "door_safety") {
    if (/\b(hang|fall|loose|stuck|off)\b/i.test(answer) && !isNo(answer)) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.doorAtRisk, [SYSTEM_SAFETY_NOTES.doorSafe])
    }
    if (
      isNo(answer) &&
      !activeSafetyNotes(safety).includes(SYSTEM_SAFETY_NOTES.doorAtRisk)
    ) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.doorSafe, [SYSTEM_SAFETY_NOTES.doorAtRisk])
    }
  }
  if (type === "hvac_heat_check") {
    if (!askedTypes.includes("hvac_behavior")) askedTypes.push("hvac_behavior")
    if (!askedTypes.includes("hvac_dangerous_temp")) askedTypes.push("hvac_dangerous_temp")
    const behavior = acBehaviorPhrase(answer)
    if (behavior) facts.hvac_behavior = behavior
    if (indicatesImmediateHeatDanger(answer)) {
      facts.hvac_immediate_danger = "yes"
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.heatIllness)
    }
  }
  if (type === "hvac_dangerous_temp" && isYes(answer)) {
    safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.dangerousTemp)
  }
  if (type === "electrical_hazard" && isYes(answer)) {
    safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.electricalHazard)
  }
  if (type === "structural_risk") {
    if (/\bwater\b/i.test(answer)) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.structuralWater)
    }
    if (/\b(?:sag(?:ging)?|collaps(?:e|ed|ing)?|fall(?:ing)?)\b/i.test(answer)) {
      safety = setSafetyNote(safety, SYSTEM_SAFETY_NOTES.structuralCollapse)
    }
  }
  if (type === "item_detail") {
    const stored = acceptItemDetailAnswer(answer)
    if (!stored) {
      const index = askedTypes.indexOf(type)
      if (index >= 0) askedTypes.splice(index, 1)
      return { ...state, asked_question_types: askedTypes }
    }
    facts.item_detail = stored
  }
  if (type === "pest_location" || type === "room_or_area") {
    const accepted = acceptLocationReply(answer)
    if (accepted) {
      room = accepted
      const follow = clarifyIssueLocation({
        text: `${tenantAuthoredText(state)} ${accepted}`,
        bedroomCount: state.property_bedroom_count,
        bathroomCount: state.property_bathroom_count,
      })
      const previous = state.diagnostic_question ?? ""
      if (follow.question && follow.question !== previous) {
        const index = askedTypes.indexOf(type)
        if (index >= 0) askedTypes.splice(index, 1)
      }
    } else {
      const extracted = extractRoomFromText(answer)
      if (extracted) room = extracted
    }
  }
  if (type === "duration_material") {
    firstNoticed = answer
  }
  safety = withApplianceLeakNote(
    safety,
    `${tenantAuthoredText({ ...state, diagnostic_facts: facts })} ${answer}`,
    state,
  )

  // Replace clarify-menu / bare-repair seed with the real symptom.
  if (type === "symptom_clarify") {
    const inferred = inferIssueTypeFromText(answer)
    const nextIssue = inferred ?? issueType
    const nextTrade = inferred === "plumbing"
      ? "plumbing"
      : inferred === "HVAC"
      ? "hvac"
      : inferred === "electrical"
      ? "electrical"
      : inferred === "leak"
      ? "plumbing"
      : inferred === "pest"
      ? "pest_control"
      : inferred === "lock"
      ? "locksmith"
      : inferred === "appliance"
      ? "appliance_repair"
      : vendorTrade
    return {
      ...state,
      asked_question_types: askedTypes,
      diagnostic_facts: facts,
      safety_concerns: safety,
      room_or_area: room,
      first_noticed: firstNoticed,
      issue_type: nextIssue,
      vendor_trade: nextTrade,
      primary_category: inferred === "HVAC"
        ? "hvac"
        : inferred === "plumbing" || inferred === "leak"
        ? "plumbing"
        : inferred === "electrical"
        ? "electrical"
        : inferred === "pest"
        ? "pest"
        : inferred === "appliance"
        ? "appliance"
        : state.primary_category,
      initial_message: answer,
      description: answer,
      sanitized_description: answer,
      open_question_asked_at: undefined,
      intake_silence_nudge_sent_at: undefined,
      intake_silence_resolved_at: undefined,
    }
  }

  const keepAnswerOffDescription = type === "item_detail" ||
    type === "unit_entry" ||
    type === "room_or_area" ||
    type === "pest_location"
  const description = keepAnswerOffDescription
    ? state.description
    : [state.description?.trim(), `${TENANT_UPDATE_PREFIX} ${answer}`].filter(Boolean).join("\n")

  return {
    ...state,
    asked_question_types: askedTypes,
    diagnostic_facts: facts,
    safety_concerns: safety,
    room_or_area: room,
    first_noticed: firstNoticed,
    issue_type: issueType,
    vendor_trade: vendorTrade,
    description,
    last_answered_question_type: type,
    last_answered_question: state.diagnostic_question,
    open_question_asked_at: undefined,
    intake_silence_nudge_sent_at: undefined,
    intake_silence_resolved_at: undefined,
  }
}

export function markQuestionAsked(
  state: SmsIntakeState,
  type: MaintenanceQuestionType,
): SmsIntakeState {
  const askedTypes = [...(state.asked_question_types ?? [])]
  if (!askedTypes.includes(type)) askedTypes.push(type)
  return { ...state, asked_question_types: askedTypes }
}
