/**
 * Dynamic SMS intake questions. Tenants give facts; Ulo classifies urgency/trade.
 * Ask only when the answer would change safety handling, routing, or next steps.
 */
import {
  applyPhotoRequestPolicy,
  computeIntakeSeverity,
  extractRoomFromText,
  recommendUrgency,
  resolveRoomLabel,
  shouldRequestIntakePhoto,
  type IntakeStep,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import { parseDurationHours } from "../../../../shared/maintenance/urgencyPolicy.ts"

export type MaintenanceQuestionType =
  | "classification_clarification"
  | "issue_type"
  | "room_or_area"
  | "plumbing_overflow"
  | "plumbing_active_flow"
  | "plumbing_hot_water_scope"
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
  | "lock_secure"
  | "general_clarify"
  | "duration_material"
  | "photo"

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
  return cat.includes("pest") || /\b(roach|roach(?:es)?|mouse|mice|rat|bug|ant|bedbug)\b/.test(hay)
}

function isStructural(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? "")
    .toLowerCase()
  return cat.includes("structural") || cat.includes("roof") || cat.includes("carpent") ||
    /\b(crack|ceiling|hole in the wall|sagging)\b/.test(hay)
}

function isLock(state: SmsIntakeState, hay: string): boolean {
  const cat = (state.primary_category ?? state.vendor_trade ?? state.issue_type ?? "")
    .toLowerCase()
  return cat.includes("lock") || /\b(won'?t lock|can'?t lock|locked out|deadbolt)\b/.test(hay)
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
    knownActiveFlow(state, hay) === true || isLock(state, hay)
  if (safety || low) return 3
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
  } else if (isStructural(state, hay)) {
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

  const overBudget = answered >= budget

  const tryAsk = (
    type: MaintenanceQuestionType,
    question: string,
    step: IntakeStep = "diagnostic",
  ): NextMaintenanceQuestion | null => {
    if (asked(state, type) || overBudget) return null
    return { shouldAsk: true, questionType: type, question, step }
  }

  if ((state.pending_issues?.length ?? 0) >= 2) {
    if (!room && !hasFixture(hay)) {
      const q = tryAsk(
        "room_or_area",
        "Which room are these mostly happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?",
        "room_or_area",
      )
      if (q) return q
    }
    const pestIssue = (state.pending_issues ?? []).some((i) =>
      /pest/i.test(i.vendor_trade) || /pest/i.test(i.issue_type)
    )
    if (pestIssue && !asked(state, "photo") && (state.photo_urls?.length ?? 0) === 0) {
      return photoQuestion(state, hay)
    }
    return { shouldAsk: false }
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

  if (isPlumbing(state, hay) && /\bno hot water|no heat(?:ed)? water\b/.test(hay)) {
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

  if (isStructural(state, hay)) {
    const q = tryAsk(
      "structural_risk",
      "Is the crack getting larger, sagging, or is there water coming through it?",
    )
    if (q) return q
  }

  if (isLock(state, hay)) {
    const q = tryAsk("lock_secure", "Are you currently able to secure the home?")
    if (q) return q
  }

  if (
    !room &&
    !hasFixture(hay) &&
    !isHvac(state, hay) &&
    !isLock(state, hay) &&
    (state.issue_type || state.vendor_trade)
  ) {
    const q = tryAsk(
      "room_or_area",
      "Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?",
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
    (asked(state, "plumbing_overflow") || asked(state, "toilet_overflow"))
  ) {
    return photoQuestion(state, hay)
  }

  if (shouldRequestIntakePhoto(state) && !asked(state, "photo")) {
    return photoQuestion(state, hay)
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

  if (type === "plumbing_overflow" || type === "toilet_overflow" || type === "plumbing_active_flow") {
    if (isNo(answer)) safety = "No overflow or standing water"
    if (isYes(answer)) safety = "Water is overflowing or actively leaking"
  }
  if (type === "lock_secure") {
    if (isNo(answer)) safety = "Unable to secure the home"
    if (isYes(answer)) safety = "Home can be secured"
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
