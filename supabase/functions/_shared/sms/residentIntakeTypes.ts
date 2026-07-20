export const ISSUE_TYPES = [
  "plumbing",
  "electrical",
  "appliance",
  "HVAC",
  "leak",
  "pest",
  "lock",
  "general",
  "other",
] as const

export type IssueType = (typeof ISSUE_TYPES)[number]

export type IntakeStep =
  | "classification_clarification"
  | "issue_type"
  | "room_or_area"
  | "first_noticed"
  | "safety_concerns"
  | "urgency"
  | "preferred_contact_method"
  | "photo"
  | "awaiting_confirm"
  | "awaiting_edit_selection"
  | "submitted"

export type SmsIntakeState = {
  step?: IntakeStep
  issue_type?: string
  /** Canonical vendor trade from unified classification pipeline. */
  vendor_trade?: string
  room_or_area?: string
  first_noticed?: string
  safety_concerns?: string
  urgency?: string
  recommended_urgency?: string
  preferred_contact_method?: string
  severity?: "low" | "normal" | "high"
  description?: string
  initial_message?: string
  /** Sanitized description from text sanitizer (audit / routing). */
  sanitized_description?: string
  edit_field?: string
  /** Raw provider media URLs collected during intake (rehosted to storage on submit). */
  photo_urls?: string[]
  /** SMS provider that delivered the media (auth needed to fetch Twilio media). */
  photo_provider?: string
  /** Clarification answers collected when classification confidence is low. */
  clarification_answers?: string[]
  clarification_attempts?: number
  clarification_question?: string
  classification_confidence?: number
  classification_pipeline_version?: string
  /** Durable maintenance_requests id minted mid-intake (before final confirm). */
  draft_ticket_id?: string
}

export const EMERGENCY_SIGNALS = [
  "flooding",
  "flood",
  "fire",
  "gas smell",
  "gas leak",
  "sparks",
  "spark",
  "no heat",
  "exposed wire",
  "exposed wires",
  "electrical hazard",
  "lock broken",
  "active leak",
  "carbon monoxide",
  "smoke",
  "water damage",
]

const KNOWN_ROOM_PATTERNS: Array<{ pattern: RegExp; room: string }> = [
  { pattern: /\b(basement|cellar)\b/i, room: "basement" },
  { pattern: /\b(kitchen)\b/i, room: "kitchen" },
  { pattern: /\b(bathroom|restroom|powder room)\b/i, room: "bathroom" },
  { pattern: /\b(bedroom|bed room)\b/i, room: "bedroom" },
  { pattern: /\b(living room|livingroom)\b/i, room: "living room" },
  { pattern: /\b(dining room|diningroom)\b/i, room: "dining room" },
  { pattern: /\b(hallway|hall)\b/i, room: "hallway" },
  { pattern: /\b(laundry room|laundry)\b/i, room: "laundry room" },
  { pattern: /\b(garage)\b/i, room: "garage" },
  { pattern: /\b(attic)\b/i, room: "attic" },
  { pattern: /\b(closet)\b/i, room: "closet" },
  { pattern: /\b(office)\b/i, room: "office" },
  { pattern: /\b(patio|balcony|deck)\b/i, room: "patio" },
]

const ISSUE_DESCRIPTION_RE =
  /\b(flood|flooding|flooded|leak|leaking|drip|broken|damaged|isn't|isnt|not working|smell|sparks|overflow|clogged|overflowing)\b/i

function cleanRoomLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(the|my|our|a|an)\s+/i, "")
    .replace(/^(in|at)\s+(the|my|our)\s+/i, "")
    .replace(/[.!?,]+$/, "")
    .trim()
}

function isLikelyIssueDescription(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= 2 && !ISSUE_DESCRIPTION_RE.test(t)) return false
  return ISSUE_DESCRIPTION_RE.test(t) || words.length > 5
}

/** Extract a clean room/area label from free-form tenant text (not the full issue sentence). */
export function extractRoomFromText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const labeled = trimmed.match(
    /\b(?:room|area|location)\s*[:—-]\s*([a-z0-9][a-z0-9\s-]{0,40})/i,
  )
  if (labeled?.[1]) {
    const room = cleanRoomLabel(labeled[1])
    if (room && !isLikelyIssueDescription(room)) return room
  }

  const inThe = trimmed.match(
    /\b(?:in|at)\s+(?:the|my|our)\s+([a-z][a-z0-9\s-]{1,30}?)(?:\s+(?:is|are|was|has|have|got|flooded|leaking|broken)\b|[.!?,]|$)/i,
  )
  if (inThe?.[1]) {
    const candidate = cleanRoomLabel(inThe[1])
    for (const { pattern, room } of KNOWN_ROOM_PATTERNS) {
      if (pattern.test(candidate) || pattern.test(trimmed)) return room
    }
    if (candidate && !isLikelyIssueDescription(candidate) && candidate.split(/\s+/).length <= 3) {
      return candidate
    }
  }

  for (const { pattern, room } of KNOWN_ROOM_PATTERNS) {
    if (pattern.test(trimmed)) return room
  }

  const myRoom = trimmed.match(
    /\bmy\s+([a-z][a-z0-9\s-]{1,24}?)(?:\s+(?:is|are|was|has|have|got|flooded|leaking|broken)\b|[.!?,]|$)/i,
  )
  if (myRoom?.[1]) {
    const candidate = cleanRoomLabel(myRoom[1])
    if (candidate && !isLikelyIssueDescription(candidate)) return candidate
  }

  if (!isLikelyIssueDescription(trimmed) && trimmed.split(/\s+/).length <= 4) {
    return cleanRoomLabel(trimmed)
  }

  return null
}

/** Normalize a room answer — never store a full issue sentence as room_or_area. */
export function normalizeRoomOrArea(
  answer: string,
  initialMessage?: string | null,
): string | null {
  const trimmed = answer.trim()
  if (!trimmed) return null

  if (
    initialMessage &&
    trimmed.toLowerCase() === initialMessage.trim().toLowerCase()
  ) {
    return extractRoomFromText(trimmed)
  }

  const extracted = extractRoomFromText(trimmed)
  if (extracted) return extracted

  if (!isLikelyIssueDescription(trimmed) && trimmed.split(/\s+/).length <= 4) {
    return cleanRoomLabel(trimmed)
  }

  return null
}

/** Resolve a clean room label from stored state (re-extract if polluted with issue text). */
export function resolveRoomLabel(state: SmsIntakeState): string | null {
  const stored = state.room_or_area?.trim()
  if (stored) {
    const normalized = normalizeRoomOrArea(stored, state.initial_message)
    if (normalized) return normalized
  }
  return extractRoomFromText(state.initial_message ?? state.description ?? "")
}

/** Natural symptom phrase derived from tenant wording + issue type. */
export function issueSymptomPhrase(state: SmsIntakeState): string {
  const combined = `${state.initial_message ?? ""} ${state.description ?? ""}`
    .toLowerCase()

  if (/\b(flood|flooding|flooded)\b/.test(combined)) return "the flooding"
  if (/\b(leak|leaking|drip|dripping)\b/.test(combined)) return "the leak"
  if (/\b(clog|clogged|backup|backed up)\b/.test(combined)) return "the clog"
  if (/\b(no heat|no ac|no cooling|not heating|not cooling)\b/.test(combined)) {
    return "the heating or cooling issue"
  }
  if (/\b(spark|sparks|exposed wire)\b/.test(combined)) return "the electrical issue"
  if (/\b(gas smell|gas leak)\b/.test(combined)) return "the gas smell"
  if (/\b(broken lock|lock broken|locked out)\b/.test(combined)) return "the lock issue"
  if (/\b(pest|roach|mouse|rat|bug)\b/.test(combined)) return "the pest issue"

  const issue = (state.issue_type ?? "").toLowerCase()
  switch (issue) {
    case "leak":
      return "the leak"
    case "plumbing":
      return "the plumbing issue"
    case "electrical":
      return "the electrical issue"
    case "appliance":
      return "the appliance issue"
    case "hvac":
      return "the heating or cooling issue"
    case "pest":
      return "the pest issue"
    case "lock":
      return "the lock issue"
    default:
      return "this"
  }
}

/** Re-normalize room_or_area on read so legacy polluted values don't leak into prompts. */
export function sanitizeIntakeState(state: SmsIntakeState): SmsIntakeState {
  const room = resolveRoomLabel(state)
  if (room && room !== state.room_or_area) {
    return { ...state, room_or_area: room }
  }

  const stepsAfterRoom: IntakeStep[] = [
    "first_noticed",
    "safety_concerns",
    "urgency",
    "preferred_contact_method",
    "photo",
    "awaiting_confirm",
  ]

  if (!room && state.room_or_area && isLikelyIssueDescription(state.room_or_area)) {
    return {
      ...state,
      room_or_area: undefined,
      step: stepsAfterRoom.includes(state.step as IntakeStep)
        ? "room_or_area"
        : state.step,
    }
  }

  if (!room && state.step && stepsAfterRoom.includes(state.step as IntakeStep)) {
    return { ...state, step: "room_or_area" }
  }

  return state
}

const ISSUE_TYPE_ALIASES: Record<string, IssueType> = {
  plumbing: "plumbing",
  plumb: "plumbing",
  pipe: "plumbing",
  electrical: "electrical",
  electric: "electrical",
  appliance: "appliance",
  appliances: "appliance",
  hvac: "HVAC",
  heat: "HVAC",
  heating: "HVAC",
  ac: "HVAC",
  "air conditioning": "HVAC",
  leak: "leak",
  leaking: "leak",
  pest: "pest",
  pests: "pest",
  bug: "pest",
  roach: "pest",
  lock: "lock",
  general: "general",
  other: "other",
}

export function parseIssueType(input: string): IssueType | null {
  const token = input.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ")
  if (!token) return null

  for (const [alias, type] of Object.entries(ISSUE_TYPE_ALIASES)) {
    if (token === alias || token.includes(alias)) return type
  }

  return null
}

export function inferIssueTypeFromText(text: string): IssueType | null {
  // Keep aligned with maintenance_classification/deterministicRules.ts
  const d = text.toLowerCase()
  if (/\b(leak|leaking|leaky|drip|dripping|flood(?:ed|ing)?|water damage)\b/.test(d)) {
    return "leak"
  }
  if (
    /\b(plumb|pipe|drain|toilet|faucet|tap|sink|basin|clog|overflow|sewage|sewer)\b/.test(d)
  ) {
    return "plumbing"
  }
  if (/\b(electric|outlet|breaker|wiring|light|power|spark)\b/.test(d)) {
    return "electrical"
  }
  if (/\b(fridge|refrigerator|washer|dryer|oven|dishwasher|microwave|appliance)\b/.test(d)) {
    return "appliance"
  }
  if (/\b(hvac|heat|heating|cool|furnace|thermostat|no heat|\bac\b)\b/.test(d)) return "HVAC"
  if (/\b(pest|roach|mouse|rat|bug|insect|termite)\b/.test(d)) return "pest"
  if (/\b(lock|key|deadbolt|door stuck|locked out)\b/.test(d)) return "lock"
  return null
}

export function detectEmergencySignals(text: string): boolean {
  const haystack = text.toLowerCase()
  return EMERGENCY_SIGNALS.some((signal) => haystack.includes(signal))
}

export function recommendUrgency(state: SmsIntakeState): string {
  const combined = [
    state.initial_message,
    state.description,
    state.safety_concerns,
    state.issue_type,
  ]
    .filter(Boolean)
    .join(" ")

  if (detectEmergencySignals(combined)) return "emergency"

  const issue = (state.issue_type ?? "").toLowerCase()
  if (issue === "leak" || issue === "electrical") {
    const safety = (state.safety_concerns ?? "").toLowerCase()
    if (safety && !/^(no|none|n\/a|nothing)/.test(safety.trim())) {
      return "urgent"
    }
  }

  return "normal"
}

export function parseUrgency(input: string): string | null {
  const t = input.trim().toLowerCase()
  if (/^emergency\b/.test(t) || t === "1") return "emergency"
  if (/^urgent\b/.test(t) || t === "2") return "urgent"
  if (/^normal\b/.test(t) || t === "3") return "normal"
  if (/^low\b/.test(t) || t === "4") return "low"
  return null
}

export function parseContactMethod(input: string): string | null {
  const t = input.trim().toLowerCase()
  if (/^(text|sms)\b/.test(t)) return "text"
  if (/^email\b/.test(t)) return "email"
  return null
}

/** System-generated severity from issue type, safety, and urgency (not tenant wording alone). */
export function computeIntakeSeverity(state: SmsIntakeState): "low" | "normal" | "high" {
  const urgency = (state.urgency ?? state.recommended_urgency ?? "").toLowerCase()
  if (urgency.includes("emergency") || urgency.includes("urgent")) return "high"

  const combined = [
    state.safety_concerns,
    state.initial_message,
    state.description,
    state.issue_type,
  ]
    .filter(Boolean)
    .join(" ")

  if (detectEmergencySignals(combined)) return "high"

  const issue = (state.issue_type ?? "").toLowerCase()
  const safety = (state.safety_concerns ?? "").trim().toLowerCase()
  const hasSafety =
    safety.length > 0 && !/^(no|none|n\/a|nothing)/.test(safety)

  if ((issue === "leak" || issue === "electrical" || issue === "lock") && hasSafety) {
    return "high"
  }

  if (urgency.includes("low")) return "low"
  return "normal"
}

export function issueTypeToCategory(issueType: IssueType | string | undefined): string {
  const t = (issueType ?? "").toLowerCase()
  if (t === "plumbing" || t === "leak") return "plumbing"
  if (t === "electrical") return "electrical"
  if (t === "appliance") return "appliance_repair"
  if (t === "hvac") return "hvac"
  if (t === "pest") return "pest_control"
  if (t === "lock") return "locksmith"
  if (t === "roofing") return "roofing"
  if (t === "general") return "general"
  return "other"
}

/** Prefer stored vendor_trade from the unified pipeline; fall back to issue_type map. */
export function resolveIntakeIssueCategory(state: SmsIntakeState): string {
  const trade = (state.vendor_trade ?? "").trim().toLowerCase()
  if (trade) {
    if (trade === "appliance") return "appliance_repair"
    if (trade === "pest") return "pest_control"
    if (trade === "lock") return "locksmith"
    return trade
  }
  return issueTypeToCategory(state.issue_type)
}

/** Map pipeline issue/trade into SMS intake issue_type enum. */
export function pipelineTradeToIssueType(
  issueType: string | null | undefined,
  vendorTrade: string | null | undefined,
): IssueType | null {
  const issue = (issueType ?? "").toLowerCase()
  if (issue === "leak") return "leak"
  if (issue === "plumbing") return "plumbing"
  if (issue === "electrical") return "electrical"
  if (issue === "appliance") return "appliance"
  if (issue === "hvac") return "HVAC"
  if (issue === "pest") return "pest"
  if (issue === "lock") return "lock"
  if (issue === "general") return "general"

  const trade = (vendorTrade ?? "").toLowerCase()
  if (trade === "plumbing") return "plumbing"
  if (trade === "electrical") return "electrical"
  if (trade === "appliance_repair") return "appliance"
  if (trade === "hvac") return "HVAC"
  if (trade === "pest_control") return "pest"
  if (trade === "locksmith") return "lock"
  if (trade === "general") return "general"
  if (trade === "roofing") return "other"
  return null
}

export function severityToDb(severity: string | undefined): "low" | "normal" | "urgent" {
  const s = (severity ?? "normal").toLowerCase()
  if (s === "high" || s === "urgent" || s === "emergency") return "urgent"
  if (s === "low") return "low"
  return "normal"
}

export function formatIssueTypeLabel(issueType: string | undefined): string {
  if (!issueType) return "Unknown"
  if (issueType === "HVAC") return "HVAC"
  return issueType.charAt(0).toUpperCase() + issueType.slice(1)
}

export function formatSeverityLabel(severity: string | undefined): string {
  const s = (severity ?? "normal").toLowerCase()
  if (s === "high" || s === "urgent" || s === "emergency") return "High"
  if (s === "low") return "Low"
  return "Medium"
}

export function formatUrgencyLabel(urgency: string | undefined): string {
  if (!urgency) return "Normal"
  return urgency.charAt(0).toUpperCase() + urgency.slice(1)
}

/** Short noun phrase for the issue — used to reference context in follow-up questions. */
export function issueContextPhrase(state: SmsIntakeState): string {
  const room = resolveRoomLabel(state)
  const symptom = issueSymptomPhrase(state)

  if (room) {
    return `${symptom} in the ${room}`
  }

  return symptom
}

/** One-line bullet for confirmation, e.g. "Kitchen sink leak". */
export function issueSummaryBullet(state: SmsIntakeState): string {
  const room = resolveRoomLabel(state)
  const issue = (state.issue_type ?? "").toLowerCase()
  const desc = (state.description ?? state.initial_message ?? "").toLowerCase()

  if (room && /\b(flood|flooding|flooded)\b/.test(desc)) return `${room} flooding`
  if (room && /\bsink\b/.test(desc) && (issue === "leak" || issue === "plumbing")) {
    return `${room} sink leak`
  }
  if (room && issue === "leak") return `${room} leak`
  if (room && issue === "plumbing") return `${room} plumbing issue`
  if (room && issue === "electrical") return `${room} electrical issue`
  if (room && issue === "appliance") return `${room} appliance issue`
  if (room && issue === "hvac") return `${room} HVAC issue`
  if (room && issue === "pest") return `${room} pest issue`
  if (room && issue === "lock") return `${room} lock issue`
  if (room) return `${room} maintenance issue`
  if (issue) return `${formatIssueTypeLabel(state.issue_type)} issue`
  return "Maintenance issue"
}

function urgencyRecommendationReason(state: SmsIntakeState): string {
  const combined = [
    state.initial_message,
    state.description,
    state.safety_concerns,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (/\b(active leak|actively leak|leaking under|water under|water damage)\b/.test(combined)) {
    return "there's active water leaking"
  }
  if (/\b(flood|flooding)\b/.test(combined)) return "you mentioned flooding"
  if (/\b(gas smell|gas leak)\b/.test(combined)) return "of the gas smell"
  if (/\b(spark|sparks|exposed wire)\b/.test(combined)) {
    return "of the electrical safety concern"
  }
  if (/\bno heat\b/.test(combined)) return "you don't have heat"
  if (/\b(fire|smoke|carbon monoxide)\b/.test(combined)) {
    return "this sounds like an immediate safety situation"
  }

  const issue = (state.issue_type ?? "").toLowerCase()
  if (issue === "leak") return "there's a leak involved"
  if (issue === "electrical") return "this involves electrical work"

  return "of what you've shared so far"
}

export function buildIntakeDescription(state: SmsIntakeState): string {
  const parts: string[] = []
  const base = state.description?.trim() || state.initial_message?.trim()
  if (base) parts.push(base)

  if (state.room_or_area?.trim()) {
    const room = resolveRoomLabel(state)
    if (room) parts.push(`Affected area: ${room}.`)
  }
  if (state.safety_concerns?.trim()) {
    parts.push(`Safety concerns: ${state.safety_concerns.trim()}.`)
  }
  if (state.first_noticed?.trim()) {
    parts.push(`First noticed: ${state.first_noticed.trim()}.`)
  }

  return parts.join("\n\n").trim() || "Maintenance issue reported via SMS."
}

function narrativeSummary(state: SmsIntakeState): string {
  const base = (state.description ?? state.initial_message ?? "").trim()
  const room = resolveRoomLabel(state)
  const safety = state.safety_concerns?.trim()
  const hasSafety = safety && !/^(no|none|n\/a|nothing)/i.test(safety)

  if (base) {
    const endsWithPunctuation = /[.!?]$/.test(base)
    let summary = endsWithPunctuation ? base : `${base}.`
    if (hasSafety && !summary.toLowerCase().includes(safety.toLowerCase().slice(0, 20))) {
      summary = `${summary} ${safety}`.trim()
    }
    return summary
  }

  if (room) {
    return `There is a ${formatIssueTypeLabel(state.issue_type).toLowerCase()} issue in the ${room}${hasSafety ? `: ${safety}` : "."}`
  }

  return "Maintenance issue reported via SMS."
}

export function buildConfirmationSummary(state: SmsIntakeState): string {
  const bullets: string[] = []
  bullets.push(`• ${issueSummaryBullet(state)}`)

  if (state.first_noticed?.trim()) {
    const noticed = state.first_noticed.trim()
    const line = /^(today|yesterday|this morning|this afternoon|last night|last week)/i.test(noticed)
      ? `Started ${noticed.charAt(0).toLowerCase()}${noticed.slice(1)}`
      : `First noticed: ${noticed}`
    bullets.push(`• ${line}`)
  }

  const safety = state.safety_concerns?.trim()
  if (safety && !/^(no|none|n\/a|nothing)/i.test(safety)) {
    bullets.push(`• ${safety}`)
  }

  bullets.push(`• Priority: ${formatUrgencyLabel(state.urgency ?? state.recommended_urgency)}`)

  return [
    "Thanks. Here's what I have:",
    "",
    ...bullets,
    "",
    "Summary:",
    narrativeSummary(state),
    "",
    "Reply YES if everything looks right, or tell me what you'd like to change.",
  ].join("\n")
}

export function intakeQuestionForStep(
  state: SmsIntakeState,
  step: Exclude<
    IntakeStep,
    | "awaiting_confirm"
    | "awaiting_edit_selection"
    | "submitted"
    | "classification_clarification"
  >,
): string {
  switch (step) {
    case "issue_type":
      return "Thanks for reaching out. I'll help get this taken care of. What kind of issue is it? Plumbing, electrical, appliance, HVAC, leak, pest, lock, or something else?"
    case "room_or_area":
      return "Sorry you're dealing with that. Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?"
    case "first_noticed": {
      const room = resolveRoomLabel(state)
      const symptom = issueSymptomPhrase(state)
      if (room) {
        return `When did you first notice ${symptom} in the ${room}?`
      }
      if (state.issue_type) {
        return `When did you first notice ${symptom}?`
      }
      return "Has this just started, or has it been going on for a while?"
    }
    case "safety_concerns":
      return "Is this causing any immediate problems, like flooding, damage, sparks, exposed wires, or anything that feels unsafe? (If not, just say none.)"
    case "preferred_contact_method":
      return "How would you like us to keep you updated? You can pick text or email."
    case "photo":
      return "One last thing that really helps: if you're able to, snap a quick photo of the issue and text it right here so the vendor knows what to expect. If you'd rather not, just reply SKIP."
    default:
      return intakeQuestionForStep(state, "issue_type")
  }
}

export function urgencyQuestion(state: SmsIntakeState, recommended?: string): string {
  const level = recommended ?? state.recommended_urgency ?? recommendUrgency(state)
  const reason = urgencyRecommendationReason(state)

  if (level === "emergency" || level === "urgent") {
    const priorityWord = level === "emergency" ? "an emergency" : "urgent"
    return `Since ${reason}, I'd treat this as ${priorityWord}. Does that sound right, or would you rate it differently? (emergency / urgent / normal / low)`
  }

  return "How would you describe the priority? Emergency, urgent, normal, or low?"
}

export const EDIT_FIELD_OPTIONS =
  "No problem! What would you like to update? You can say issue type, room/area, urgency, safety, when you noticed, contact method, photo, or description."

export const INTAKE_VALIDATION = {
  issue_type:
    "I didn't quite catch that. Could you reply with plumbing, electrical, appliance, HVAC, leak, pest, lock, general, or other?",
  urgency:
    "Just to confirm, would you call this emergency, urgent, normal, or low?",
  contact_method:
    "Would you prefer text or email for updates?",
} as const

export function parseEditFieldChoice(input: string): IntakeStep | "description" | null {
  const t = input.trim().toLowerCase()
  if (/issue\s*type|^type$/.test(t)) return "issue_type"
  if (/area|room/.test(t)) return "room_or_area"
  if (/urgency|priority/.test(t)) return "urgency"
  if (/safety/.test(t)) return "safety_concerns"
  if (/when|noticed|first/.test(t)) return "first_noticed"
  if (/contact|updates/.test(t)) return "preferred_contact_method"
  if (/photo|picture|pic|image/.test(t)) return "photo"
  if (/^description$|^details$/.test(t)) return "description"
  return null
}

/** Next step after collecting a field — skips room when location is already known. */
export function nextCollectingStep(
  current: IntakeStep | undefined,
  state?: SmsIntakeState,
): IntakeStep {
  switch (current) {
    case "issue_type":
      return resolveRoomLabel(state ?? {}) ? "first_noticed" : "room_or_area"
    case "room_or_area":
      return "first_noticed"
    case "first_noticed":
      return "safety_concerns"
    case "safety_concerns":
      return "urgency"
    case "urgency":
      return "preferred_contact_method"
    case "preferred_contact_method":
      return "photo"
    case "photo":
      return "awaiting_confirm"
    default:
      return "issue_type"
  }
}

export function conversationStatusForStep(step: IntakeStep): string {
  if (step === "awaiting_confirm") return "intake_confirm"
  if (step === "awaiting_edit_selection") return "intake_edit"
  if (step === "submitted") return "open"
  return "intake_collecting"
}
