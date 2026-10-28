/**
 * One missing identifier for the affected item.
 * Uses only the resident's words. Emergencies do not wait on it.
 */
import { isGasEmergencyText, resolveUrgencyPolicy } from "./urgencyPolicy.ts"

const NOT_SURE =
  /^(?:not sure|unsure|idk|i don't know|i dont know|unknown|maybe)$/i

const LIGHT_MOUNT =
  /\b(?:ceiling|wall[-\s]?mounted|sconce|recessed|chandelier|vanity|lamp|night ?light|flush mount|pendant|track light|can light)\b/i

const LEAK_SOURCE =
  /\b(?:sink|faucet|toilet|pipe|ceiling|roof|fridge|refrigerator|dishwasher|washer|dryer|water heater|tub|shower|ac|a\/c|hvac)\b/i

const NAMED_APPLIANCE =
  /\b(?:fridge|refrigerator|stove|oven|dishwasher|washer|dryer|microwave|disposal|garbage disposal|freezer)\b/i

const NAMED_PEST =
  /\b(?:roach(?:es)?|cockroach(?:es)?|mouse|mice|rat|rats|ant|ants|bed ?bugs?|termite|wasp|wasps|bee|bees|spider|spiders|flea|fleas|silverfish)\b/i

const WINDOW_PROBLEM =
  /\b(?:broken|cracked|stuck|won'?t|leak|draft|lock|latch|open|close|fogged|shattered)\b/i

export function isItemDetailNotSure(text: string | null | undefined): boolean {
  return NOT_SURE.test((text ?? "").replace(/\s+/g, " ").trim())
}

function isEmergency(text: string): boolean {
  return isGasEmergencyText(text) || resolveUrgencyPolicy({ text }).band === "emergency"
}

function isLightOutage(text: string): boolean {
  return /\b(?:light|lamp|fixture|sconce|chandelier)\b/i.test(text) &&
    /\b(?:out|isn'?t working|not working|won'?t(?: turn on| work)?|burned out|dead)\b/i.test(text)
}

/** The one useful item question still missing, or null. */
export function itemDetailQuestion(text: string | null | undefined): string | null {
  const body = (text ?? "").replace(/\s+/g, " ").trim()
  if (!body || isEmergency(body)) return null

  if (isLightOutage(body) && !LIGHT_MOUNT.test(body)) {
    return "Is it a ceiling light, a wall-mounted light, or something else?"
  }
  if (/\b(?:leak(?:ing)?|dripp(?:ing)?)\b/i.test(body) && !/\bgas\b/i.test(body) && !LEAK_SOURCE.test(body)) {
    return "What appears to be leaking? For example, a pipe, the ceiling, or an appliance."
  }
  if (/\bappliance\b/i.test(body) && !NAMED_APPLIANCE.test(body)) {
    return "Which appliance is it?"
  }
  if (/\bwindow\b/i.test(body) && !WINDOW_PROBLEM.test(body)) {
    return "What isn't working with the window?"
  }
  if (/\b(?:pest|bugs?|insects?)\b/i.test(body) && !NAMED_PEST.test(body)) {
    return "What did you see?"
  }
  return null
}

/** Keep a resident's answer. "Not sure" is stored and does not invent a type. */
export function acceptItemDetailAnswer(answer: string | null | undefined): string | null {
  const text = (answer ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "")
  if (!text) return null
  if (isItemDetailNotSure(text)) return "not_sure"
  if (/^(?:y|yes|n|no|nope|ok|okay)$/i.test(text)) return null
  if (text.length > 80) return null
  if (/\bor something else\b/i.test(text)) return null
  if (/\bceiling\b/i.test(text) && /\bwall[-\s]?mounted\b/i.test(text)) return null
  return text.replace(/^(?:it(?: is|'s)|its|a|an|the)\s+/i, "").trim().toLowerCase()
}

/** Noun to show after the resident confirms it. Null when they are unsure. */
export function confirmedItemPhrase(
  problem: string | null | undefined,
  detail: string | null | undefined,
): string | null {
  const raw = (detail ?? "").replace(/\s+/g, " ").trim()
  if (!raw || raw === "not_sure") return null
  const problemText = problem ?? ""
  if (isLightOutage(problemText) || /\b(?:light|fixture)\b/i.test(problemText)) {
    if (/\bceiling\b/i.test(raw)) return "ceiling light"
    if (/\bwall\b/i.test(raw)) return "wall-mounted light"
    if (/\blight\b/i.test(raw)) return raw.replace(/^(?:a|an|the)\s+/i, "")
    return raw
  }
  return raw.replace(/^(?:a|an|the)\s+/i, "")
}
