/**
 * Dynamic SMS intake questions. Tenants give facts; Ulo classifies urgency/trade.
 * Ask only when the answer would change safety handling, routing, or next steps.
 */
import {
  applyPhotoRequestPolicy,
  computeIntakeSeverity,
  extractRoomFromText,
  inferIssueTypeFromText,
  recommendUrgency,
  resolveRoomLabel,
  shouldRequestIntakePhoto,
  type IntakeStep,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import { isVagueTicketDescription, looksLikeBareRepairRequest } from "./clarifyMenuIntakeSeed.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import { parseDurationHours } from "../../../../shared/maintenance/urgencyPolicy.ts"
import { matchesWaterOutage } from "../../../../shared/maintenance/deterministicRules.ts"

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
  | "hvac_dangerous_temp"
  | "electrical_scope"
  | "electrical_hazard"
  | "appliance_symptom"
  | "pest_frequency"
  | "pest_location"
  | "structural_risk"
  | "door_part"
  | "door_safety"
  | "lock_secure"
  | "general_clarify"
  | "symptom_clarify"
  | "duration_material"
  | "photo"
  | "unit_entry"

export type NextMaintenanceQuestion =
  | {
    shouldAsk: true
    questionType: MaintenanceQuestionType
    question: string
    step: IntakeStep
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
    /\b(it is|still is|overflowing|pouring|leaking|flowing)\b/i.test(text)
}

function isNo(text: string): boolean {
  return /^(n|no|nope|nah)\b/.test(text.trim().toLowerCase()) ||
    /\b(not overflowing|not leaking|no leak|none|it'?s not)\b/i.test(text)
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

function isElectrical(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("electric") || /\b(outlet|breaker|spark|power out)\b/.test(hay)
}

function isAppliance(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("appliance") ||
    /\b(washer|washing machine|dryer|dishwasher|fridge|oven|stove|microwave)\b/.test(hay)
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
    if (isYes(stored)) return true
    if (isNo(stored)) return false
  }
  if (/\b(?:no|not|without)\s+(?:an?\s+)?(?:active\s+)?overflow(?:ing)?\b/.test(hay)) return false
  if (/\b(overflow(?:ing)?|pouring|gushing|flooding|water everywhere)\b/.test(hay)) return true
  return null
}

function knownActiveFlow(state: SmsIntakeState, hay: string): boolean | null {
  const stored = fact(state, "plumbing_active_flow")
  if (stored) {
    if (isYes(stored)) return true
    if (isNo(stored)) return false
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
  if (/\bsink|drain|clog\b/.test(hay)) {
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

  const seed = (state.description ?? state.initial_message ?? "").trim()
  if (!seed) return next

  const confirmation = recognizeInboundIntentSync(seed).confirmation
  if (!confirmation) return next
  return { ...next, question: `${confirmation}\n\n${next.question}` }
}

function resolveNextMaintenanceQuestion(
  state: SmsIntakeState,
): NextMaintenanceQuestion {
  const hay = haystack(state)
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
      question:
        "Got it — what needs to be fixed? For example: no hot water, a leak, no heat, or an outlet issue.",
      step: "diagnostic",
    }
  }

  const overBudget = answered >= budget
  const door = doorHay(state, hay)
  const multi = (state.pending_issues?.length ?? 0) >= 2
  const sharedRoomQuestion = multi
    ? "Which room are these mostly happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?"
    : "Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?"

  const tryAsk = (
    type: MaintenanceQuestionType,
    question: string,
    step: IntakeStep = "diagnostic",
  ): NextMaintenanceQuestion | null => {
    if (asked(state, type)) return null
    const safetyFollowUp = type === "lock_secure" || type === "door_safety" ||
      type === "door_part" || type === "electrical_hazard" ||
      type === "structural_risk" || type === "plumbing_active_flow" ||
      type === "hvac_dangerous_temp" || type === "unit_entry"
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

  if (isPlumbing(state, hay) && /\btoilet\b/.test(hay) && /\bclog|backup|won'?t (?:flush|go down)\b/.test(hay)) {
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
  if (isPlumbing(state, hay) && matchesWaterOutage(hay)) {
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
    !matchesWaterOutage(hay) &&
    /\bno hot water|no heat(?:ed)? water\b/.test(hay)
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

  if (isHvac(state, hay) && !fact(state, "hvac_behavior")) {
    const q = tryAsk(
      "hvac_behavior",
      "Is the system running but not cooling, or is it not turning on at all? You can say running but warm, no airflow, won't turn on, or not sure.",
    )
    if (q) return q
  }

  if (isHvac(state, hay)) {
    const extreme = (state.outdoor_temp_f != null &&
      (state.outdoor_temp_f >= 88 || state.outdoor_temp_f <= 40)) ||
      /\bno heat|no ac|not cooling|not heating\b/.test(hay)
    if (extreme && !fact(state, "hvac_dangerous_temp")) {
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

  if (isElectrical(state, hay) && /\b(outlet|room|bedroom|lights?)\b/.test(hay)) {
    const q = tryAsk(
      "electrical_scope",
      "Is power out only in that room, or in other parts of the home too?",
    )
    if (q) return q
  }

  if (isAppliance(state, hay) && !/\b(pouring|leaking onto|water on the floor)\b/.test(hay)) {
    const q = tryAsk(
      "appliance_symptom",
      "What happens when you try to start it? For example: won't power on, won't drain, leaking, loud noise, stuck door, or something else.",
    )
    if (q) return q
  }

  if (isPest(state, hay)) {
    const q = tryAsk(
      "pest_frequency",
      "Have you seen just one, or are you seeing them repeatedly?",
    )
    if (q) return q
    if (!room) {
      const loc = tryAsk(
        "pest_location",
        "Where are you seeing them most — kitchen, bathroom, bedroom, or multiple rooms?",
      )
      if (loc) return loc
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
      "Which room is that door in? Kitchen, bathroom, bedroom, front entrance, or somewhere else?",
      "room_or_area",
    )
    if (q) return q
  }

  if (shouldAskStructuralRisk(state, hay)) {
    const q = tryAsk(
      "structural_risk",
      "Is the crack getting larger, sagging, or is there water coming through it?",
    )
    if (q) return q
  }

  if (isLock(state, hay) && !isDoorComplaint(state, hay)) {
    const q = tryAsk("lock_secure", "Are you currently able to secure the home?")
    if (q) return q
  }

  if (
    !room &&
    !hasFixture(hay) &&
    !isHvac(state, hay) &&
    !isLock(state, hay) &&
    !isDoorComplaint(state, hay) &&
    (state.issue_type || state.vendor_trade)
  ) {
    const q = tryAsk(
      "room_or_area",
      sharedRoomQuestion,
      "room_or_area",
    )
    if (q) return q
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
      "If you're not home, may staff or a vendor enter the unit to make the repair? Reply YES or NO.",
      "diagnostic",
    )
    if (q) return q
  }

  return { shouldAsk: false }
}

export function applyQuestionPlan(state: SmsIntakeState): SmsIntakeState {
  const withContact: SmsIntakeState = {
    ...state,
    preferred_contact_method: state.preferred_contact_method?.trim() || "text",
  }
  const withPhoto = applyPhotoRequestPolicy(withContact)
  const urgency = recommendUrgency(withPhoto)
  const prepared: SmsIntakeState = {
    ...withPhoto,
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
        diagnostic_question:
          "Got it — what needs to be fixed? For example: no hot water, a leak, no heat, or an outlet issue.",
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
  return {
    ...prepared,
    step: next.step,
    diagnostic_question_type: next.questionType,
    diagnostic_question: next.question,
  }
}

export function applyDiagnosticAnswer(
  state: SmsIntakeState,
  body: string,
): SmsIntakeState {
  const type = state.diagnostic_question_type || "general_clarify"
  const answer = body.trim()
  const askedTypes = [...(state.asked_question_types ?? [])]
  if (!askedTypes.includes(type)) askedTypes.push(type)

  const facts = { ...(state.diagnostic_facts ?? {}), [type]: answer }
  let safety = state.safety_concerns
  let room = state.room_or_area
  let firstNoticed = state.first_noticed

  let issueType = state.issue_type
  let vendorTrade = state.vendor_trade

  if (type === "plumbing_overflow" || type === "toilet_overflow" || type === "plumbing_active_flow") {
    if (isNo(answer)) safety = "Water is not actively overflowing"
    if (isYes(answer)) safety = "Water is actively overflowing or leaking"
  }
  if (type === "lock_secure") {
    if (isNo(answer)) safety = "Unable to secure the home"
    if (isYes(answer)) safety = "Home can be secured"
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
      safety = "Door may be stuck, hanging loose, or at risk of falling"
    }
    if (isNo(answer)) safety = safety ?? "Door is not hanging or at risk of falling"
  }
  if (type === "hvac_dangerous_temp" && isYes(answer)) {
    safety = "Home is becoming dangerously hot or cold"
  }
  if (type === "electrical_hazard" && isYes(answer)) {
    safety = "Sparks, smoke, or burning smell reported"
  }
  if (type === "structural_risk") {
    if (/\bwater\b/i.test(answer)) safety = "Water coming through structural damage"
    if (/\bsag|collaps|fall/i.test(answer)) safety = "Possible collapse or sagging"
  }
  if (type === "pest_location" || type === "room_or_area") {
    const extracted = extractRoomFromText(answer)
    if (extracted) room = extracted
  }
  if (type === "duration_material") {
    firstNoticed = answer
  }
  if (type === "appliance_symptom" && /\b(leak|pour|water|floor)\b/i.test(answer)) {
    safety = "Appliance leaking water"
  }

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
    }
  }

  const description = [state.description?.trim(), `Tenant update: ${answer}`]
    .filter(Boolean)
    .join("\n")

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
