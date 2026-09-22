/**
 * Text Ulo writes about a request, kept apart from text the resident wrote.
 *
 * Intake folds answers into the description and turns yes/no answers into
 * plain-language safety notes. Those notes read like problem reports, because
 * that is their job — "Water is actively overflowing or leaking". Feeding them
 * back through the recognizer made Ulo classify its own words: a resident who
 * said the sink was *not* overflowing got a note whose text matched the
 * loss-of-water rules, and intake asked whether the water was out everywhere.
 *
 * So every system-written string lives here, in one list the tests can walk,
 * and recognizer-facing code reads `tenantAuthoredText` instead of the
 * composed description.
 */

/** Label intake writes when it folds an answer into the description. */
export const TENANT_UPDATE_PREFIX = "Tenant update:"

/** Plain-language notes intake writes from a yes/no safety answer. */
export const SYSTEM_SAFETY_NOTES = {
  overflowNo: "Water is not actively overflowing",
  overflowYes: "Water is actively overflowing or leaking",
  cannotSecure: "Unable to secure the home",
  canSecure: "Home can be secured",
  doorAtRisk: "Door may be stuck, hanging loose, or at risk of falling",
  doorSafe: "Door is not hanging or at risk of falling",
  dangerousTemp: "Home is becoming dangerously hot or cold",
  electricalHazard: "Sparks, smoke, or burning smell reported",
  structuralWater: "Water coming through structural damage",
  structuralCollapse: "Possible collapse or sagging",
  applianceLeak: "Appliance leaking water",
  noneReported: "None reported",
} as const

/**
 * Every string intake writes into description or safety text. Tests walk this
 * to prove none of them can be read back as a new issue.
 */
export const INTAKE_SYSTEM_TEXT: readonly string[] = [
  TENANT_UPDATE_PREFIX,
  ...Object.values(SYSTEM_SAFETY_NOTES),
]

const SYSTEM_TEXT_RE = new RegExp(
  INTAKE_SYSTEM_TEXT
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "gi",
)

/** Drop Ulo's own wording, leaving only what the resident typed. */
export function stripSystemIntakeText(text: string): string {
  return text.replace(SYSTEM_TEXT_RE, " ").replace(/\s+/g, " ").trim()
}

/** The parts of intake state a resident actually typed. */
export type TenantAuthoredSource = {
  initial_message?: string
  description?: string
  diagnostic_facts?: Record<string, string>
  clarification_answers?: string[]
}

/**
 * What the resident said, and nothing Ulo said. Safety notes are deliberately
 * left out: they are Ulo's summary of an answer, not the answer.
 */
export function tenantAuthoredText(state: TenantAuthoredSource): string {
  return [
    state.initial_message,
    state.description,
    ...Object.values(state.diagnostic_facts ?? {}),
    ...(state.clarification_answers ?? []),
  ]
    .filter(Boolean)
    .map((part) => stripSystemIntakeText(String(part)))
    .filter(Boolean)
    .join(" ")
}
