/**
 * Vendor job-offer facts. Uses the resident's confirmed problem, place, and
 * scope. A missing detail is left out. A later problem statement replaces the
 * opening when the resident updated what is wrong.
 */
import { parseIntakeDescriptionParts } from "./intakeDescriptionParse.ts"
import {
  interpretConfirmedLocation,
  problemSentence,
  scopeSentence,
} from "./requestConfirmation.ts"

export type VendorJobOfferInput = {
  description?: string | null
  issueHeadline?: string | null
  /** Question Ulo asked before accepting a place, when the thread still has it. */
  locationQuestion?: string | null
  /** Place the resident confirmed. Falls back to the stored affected area. */
  locationAnswer?: string | null
  facts?: Record<string, string | null | undefined> | null
  safetyConcern?: string | null
}

const WEAK_ISSUE =
  /^(?:maintenance issue|see (?:the )?work order for details|unknown issue|(?:electrical|plumbing|hvac|appliance|general|pest|lock|other|unknown) issue)$/i

const PERMISSION_ONLY =
  /^(?:y|yes|yeah|yep|yup|n|no|nope|nah|ok|okay|not sure|unsure)$/i

const PROBLEM_UPDATE =
  /\b(?:won't|wont|can't|cannot|isn't|isnt|not working|leak(?:ing)?|drip(?:ping)?|smell|spark(?:ing)?|broken|clog(?:ged)?|flood(?:ing)?|turn on|no heat|no (?:hot )?water|running)\b/i

const SAFETY_FOR_VENDOR: Record<string, string> = {
  "Water is actively overflowing or leaking": "Water is actively overflowing or leaking.",
  "Unable to secure the home": "The home cannot be secured.",
  "Door may be stuck, hanging loose, or at risk of falling":
    "The door may be stuck, hanging loose, or at risk of falling.",
  "Home is becoming dangerously hot or cold": "The temperature in the home feels dangerous.",
  "Someone in the home may be unwell from the heat": "Someone in the home feels unwell.",
  "Sparks, smoke, or burning smell reported": "Sparks, smoke, or a burning smell were reported.",
  "Water coming through structural damage": "Water is coming through the damaged area.",
  "Possible collapse or sagging": "There may be sagging or a risk of collapse.",
  "Appliance leaking water": "The appliance is leaking water.",
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function isWeakIssue(value: string): boolean {
  return WEAK_ISSUE.test(value.replace(/[.!?]+$/g, "").trim())
}

function ensureSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "")
  if (!trimmed) return ""
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return `${cased}.`
}

/** Scope the resident confirmed, in the vendor's issue paragraph. */
export function vendorScopeLine(value: string | null | undefined): string | null {
  const base = scopeSentence(value)
  if (!base) return null
  if (base === "The issue is limited to that room.") {
    return "The tenant reports the issue is limited to that room."
  }
  if (base === "It is also happening in other parts of the home.") {
    return "The tenant reports it is also happening in other parts of the home."
  }
  return null
}

function isLocationOnly(text: string): boolean {
  const trimmed = clean(text)
  if (!trimmed || trimmed.length > 40) return false
  if (PROBLEM_UPDATE.test(trimmed)) return false
  return trimmed.split(/\s+/).length <= 4
}

function looksLikeProblemUpdate(text: string): boolean {
  const trimmed = clean(text)
  if (!trimmed || PERMISSION_ONLY.test(trimmed)) return false
  if (vendorScopeLine(trimmed) || scopeSentence(trimmed)) return false
  if (isLocationOnly(trimmed)) return false
  return PROBLEM_UPDATE.test(trimmed)
}

function latestProblemText(opening: string, updates: string[]): string {
  let current = opening
  for (const update of updates) {
    if (looksLikeProblemUpdate(update)) current = update
  }
  return current
}

function factLine(key: string, value: string): string | null {
  const trimmed = clean(value)
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (key === "electrical_scope") return vendorScopeLine(trimmed)
  if (key === "hvac_behavior") {
    if (lower === "not turning on") return "The AC is not turning on."
    if (lower === "blowing warm air") return "The AC is blowing warm air."
    return null
  }
  if (key === "plumbing_hot_water_scope" || key === "plumbing_water_outage_scope") {
    if (lower === "everywhere in the home" || lower === "there's no water anywhere") {
      return "The tenant reports the water is out everywhere in the home."
    }
    if (/^(?:only|just) the kitchen(?: sink)?$/.test(lower)) {
      return "The tenant reports this is only at the kitchen."
    }
    return null
  }
  if (key === "door_part") {
    const part = trimmed.replace(/^the\s+/i, "")
    return ensureSentence(`The problem is the ${part}`)
  }
  if (key === "appliance_symptom" && trimmed.length <= 80 && !PERMISSION_ONLY.test(trimmed)) {
    return ensureSentence(trimmed)
  }
  return null
}

function safetyLine(value: string | null | undefined): string | null {
  const trimmed = clean(value)
  if (!trimmed) return null
  if (/^(?:none|no|n\/a|nothing|none reported)$/i.test(trimmed)) return null
  return SAFETY_FOR_VENDOR[trimmed] ?? null
}

function usablePlace(value: string): string {
  const trimmed = clean(value).replace(/[.]+$/g, "")
  if (!trimmed || trimmed.length > 40) return ""
  if (/[.!?]/.test(trimmed)) return ""
  if (/entry if|tenant update|safety concerns|first noticed|resident availability/i.test(trimmed)) {
    return ""
  }
  return trimmed
}

function firstScope(updates: string[], facts: Record<string, string | null | undefined> | null | undefined): string | null {
  const candidates = [
    facts?.electrical_scope,
    ...updates,
  ]
  for (const candidate of candidates) {
    const line = vendorScopeLine(candidate)
    if (line) return line
  }
  return null
}

/**
 * One issue paragraph for a vendor offer.
 * Returns null when there is nothing confirmed to say.
 */
export function composeVendorJobOfferIssue(input: VendorJobOfferInput): string | null {
  const parts = parseIntakeDescriptionParts(input.description ?? "")
  const opening = clean(parts.openingMessage)
  const problemSource = latestProblemText(opening, parts.tenantUpdates)
  const headline = clean(input.issueHeadline)
  const labeledPlace = usablePlace(parts.labeledFields["Affected area"] ?? "")
  const answer = usablePlace(input.locationAnswer ?? "") || labeledPlace
  const question = clean(input.locationQuestion)
  const reading = answer && !vendorScopeLine(answer) && !PERMISSION_ONLY.test(answer)
    ? interpretConfirmedLocation({
      problem: problemSource || opening || headline,
      answer,
      question: question || null,
    })
    : { location: null, clarification: null }
  const location = reading.clarification ? null : reading.location

  let problem = ""
  if (problemSource) {
    problem = problemSentence(problemSource, location)
  }
  if (!problem || isWeakIssue(problem)) {
    if (headline && !isWeakIssue(headline)) {
      problem = /[.!?]$/.test(headline) ? headline : ensureSentence(headline)
      if (location && !problem.toLowerCase().includes(location.toLowerCase())) {
        problem = `${problem.replace(/[.!?]+$/g, "")}. It is in the ${location}.`
      }
    } else if (!problem && headline) {
      problem = headline
    }
  }

  const scope = firstScope(parts.tenantUpdates, input.facts)
  const details: string[] = []
  for (const [key, value] of Object.entries(input.facts ?? {})) {
    if (key === "unit_entry" || key === "electrical_scope" || key === "self_fix_tip" || key === "self_fix_result") {
      continue
    }
    const line = factLine(key, value ?? "")
    if (line) details.push(line)
  }
  const safety = safetyLine(input.safetyConcern)
  if (safety) details.push(safety)

  const sentences: string[] = []
  const seen = new Set<string>()
  for (const line of [problem, scope, ...details]) {
    const trimmed = clean(line)
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sentences.push(trimmed)
  }
  if (sentences.length === 0) return null
  if (sentences.length === 1 && isWeakIssue(sentences[0]!) && !headline) return null
  return sentences.join(" ")
}

/** Yes/no entry from the labeled description. Unknown and "not sure" stay unset. */
export function entryOkFromConfirmedText(description?: string | null): boolean | null {
  const parts = parseIntakeDescriptionParts(description ?? "")
  const raw = clean(
    parts.labeledFields["Entry if not home"] || parts.labeledFields["Entry if absent"],
  )
  if (!raw) return null
  const value = raw.toLowerCase()
  if (/^(?:not sure|unsure|unknown|maybe)$/.test(value)) return null
  if (/^(?:y|yes|yeah|yep|yup)\b/.test(value)) return true
  if (/^(?:n|no|nope|nah)\b/.test(value)) return false
  return null
}
