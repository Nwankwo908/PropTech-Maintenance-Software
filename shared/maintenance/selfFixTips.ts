/**
 * Reviewed self-fix tips. Chosen by rules from classifier output.
 * No model calls.
 */
import { matchEmergencyNet } from "./deterministicRules.ts"
import { resolveUrgencyPolicy } from "./urgencyPolicy.ts"

export type SelfFixTipId =
  | "gfci_reset"
  | "breaker_reset"
  | "disposal_reset"
  | "toilet_clog"
  | "toilet_running"
  | "thermostat_check"
  | "hvac_filter"
  | "smoke_chirp"
  | "dishwasher_drain"
  | "sink_slow_drain"
  | "fridge_not_cooling"
  | "washer_wont_start"

export type SelfFixResult = "fixed" | "not_fixed" | "skipped"

export type SelfFixTip = {
  id: SelfFixTipId
  /** Short name used in landlord and activity lines. */
  label: string
  /** One question asking the tenant to try it. */
  tenantAsk: string
  /** Vacant / no-tenant line. Must be 90 characters or fewer. */
  landlordLine: string
  steps: readonly string[]
  successSignal: RegExp
  failureSignal: RegExp
  matches: (text: string) => boolean
}

export type SelfFixTicket = {
  text?: string | null
  trade?: string | null
  issueType?: string | null
  outdoorTempF?: number | null
  diagnosticFacts?: Record<string, string> | null
  /** Home Check, inspection, or observation — not a live problem. */
  origin?: string | null
  observationOnly?: boolean | null
  /** Default on. False when the landlord turned tips off. */
  tipsEnabled?: boolean | null
  /** False for a vacant unit or a proactive job with no resident. */
  hasTenant?: boolean | null
}

export const TENANT_SELF_FIX_CLOSE_SMS =
  "Great — glad that fixed it. Text me if it happens again."

const TRIED_PREFIX = "Tenant already tried the "
const TRIED_SUFFIX = " — still out."

function triedLine(label: string): string {
  return `${TRIED_PREFIX}${label}${TRIED_SUFFIX}`
}

export const SELF_FIX_TIPS: readonly SelfFixTip[] = [
  {
    id: "gfci_reset",
    label: "GFCI reset",
    tenantAsk:
      "Is there an outlet near the sink with TEST and RESET buttons? Press RESET and tell me if power comes back.",
    landlordLine:
      "Quick check first: press RESET on the outlet by the sink. Reply FIXED if it works.",
    steps: [
      "Find the outlet near the sink with TEST and RESET buttons.",
      "Press RESET until it clicks.",
      "See if the power comes back.",
    ],
    successSignal: /\b(power(?:'s| is)? back|came back|works|working)\b/i,
    failureSignal: /\b(still out|still dead|didn't work|did not work|no power)\b/i,
    matches: (text) =>
      /\b(outlet|outlets|plug|gfci)\b/.test(text) &&
      /\b(dead|not working|no power|won't work|does not work|out)\b/.test(text) &&
      /\b(kitchen|bath|bathroom|garage|sink)\b/.test(text),
  },
  {
    id: "breaker_reset",
    label: "breaker reset",
    tenantAsk:
      "Is the power out in just one room? Flip the tripped breaker fully off, then back on, and tell me if the power comes back.",
    landlordLine:
      "Quick check first: flip that room's breaker off, then on. Reply FIXED if it works.",
    steps: [
      "Open the breaker door. Leave the metal cover on.",
      "Find the switch that sits off to the side.",
      "Flip it fully off, then fully on.",
    ],
    successSignal: /\b(came back|power(?:'s| is)? back|works|lights? (?:are )?on)\b/i,
    failureSignal: /\b(still out|still dark|didn't work|did not work)\b/i,
    matches: (text) =>
      /\b(power(?:\s+is)?\s+out|no power|lights?(?:\s+are)?\s+out|lost power)\b/.test(text) &&
      /\b(one room|that room|bedroom|living room|just (?:the |this )?room|only)\b/.test(text) &&
      !/\b(entire|whole)\s+(unit|apartment|home|house)\b/.test(text),
  },
  {
    id: "disposal_reset",
    label: "disposal reset",
    tenantAsk:
      "Is the disposal humming or not starting? Turn it off, press the red reset button underneath, and tell me if it runs.",
    landlordLine:
      "Quick check: switch off, then press the red reset underneath. Reply FIXED if it runs.",
    steps: [
      "Turn the wall switch off.",
      "Press the red button under the disposal.",
      "Turn the switch on and try it again.",
    ],
    successSignal: /\b(runs|running|works|came on|it works)\b/i,
    failureSignal: /\b(still (?:hums|humming|dead|won't)|didn't work|did not work|no)\b/i,
    matches: (text) =>
      /\b(disposal|garbage disposal)\b/.test(text) &&
      /\b(hum|hums|humming|won't run|will not run|not starting|doesn't start|does not start|stuck)\b/.test(text),
  },
  {
    id: "toilet_clog",
    label: "plunger",
    tenantAsk:
      "Is the toilet clogged but not overflowing? Try a plunger, and stop if the water rises. Did it clear?",
    landlordLine:
      "Quick check first: plunge the toilet. Stop if water rises. Reply FIXED if it clears.",
    steps: [
      "Use a plunger over the drain.",
      "Plunge slowly a few times.",
      "Stop right away if the water starts to rise.",
    ],
    successSignal: /\b(cleared|clear|flushed|works|went down)\b/i,
    failureSignal: /\b(still clogged|didn't work|did not work|won't flush)\b/i,
    matches: (text) =>
      /\btoilet\b/.test(text) &&
      /\b(clog|clogged|won't flush|will not flush|not flushing)\b/.test(text) &&
      !/\bsewage\b/.test(text) &&
      !(/\boverflow/.test(text) && !/\bnot overflowing\b/.test(text)) &&
      !(/\brising\b/.test(text) && !/\bnot rising\b/.test(text)),
  },
  {
    id: "toilet_running",
    label: "flapper check",
    tenantAsk:
      "Is the toilet running on its own? Jiggle the handle so the flapper closes, and tell me if it stops.",
    landlordLine:
      "Quick check first: jiggle the handle so the flapper drops. Reply FIXED if it stops.",
    steps: [
      "Lift the tank lid off and set it somewhere safe.",
      "Jiggle the handle.",
      "Make sure the chain lets the flapper drop and close.",
    ],
    successSignal: /\b(stopped|stops|quiet|works|fixed)\b/i,
    failureSignal: /\b(still running|keeps running|didn't work|did not work)\b/i,
    matches: (text) =>
      /\btoilet\b/.test(text) &&
      /\b(running|won't stop|will not stop|keeps running|runs all|flapper)\b/.test(text) &&
      !/\b(clog|overflow)\b/.test(text),
  },
  {
    id: "thermostat_check",
    label: "thermostat check",
    tenantAsk:
      "Is the heat or AC not coming on? Set the mode and temperature, try fresh batteries, and tell me if it starts.",
    landlordLine:
      "Quick check: set the mode and temp, or try new batteries. Reply FIXED if it works.",
    steps: [
      "Set it to heat or cool, whichever you need.",
      "Set the temperature a few degrees past the room.",
      "If the screen is blank, put in fresh batteries.",
    ],
    successSignal: /\b(came on|starts|started|working|heat(?:'s| is) on|cooling)\b/i,
    failureSignal: /\b(still (?:off|nothing|cold|hot)|didn't work|did not work)\b/i,
    matches: (text) =>
      /\b(no heat|no ac|no a\/c|not heating|thermostat|heat or ac|ac not)\b/.test(text) &&
      !/\b(fridge|refrigerator)\b/.test(text) &&
      !/\b(furnace|boiler)\b/.test(text),
  },
  {
    id: "hvac_filter",
    label: "filter check",
    tenantAsk:
      "Is the airflow weak? If you can reach the filter without tools, check whether it is clogged and tell me what you see.",
    landlordLine:
      "Quick check: reach the filter and see if it's clogged. Reply FIXED if air improves.",
    steps: [
      "Only do this if you can reach the filter without tools.",
      "Slide the filter out and look at it.",
      "If it is packed with dust and you have a spare, put the spare in.",
    ],
    successSignal: /\b(better|improved|airflow|works|stronger)\b/i,
    failureSignal: /\b(still weak|still nothing|didn't work|did not work|can't reach|cannot reach)\b/i,
    matches: (text) =>
      /\b(weak airflow|little air|not much air|airflow|air flow|filter)\b/.test(text) &&
      /\b(weak|clogged|dirty|little|low|not much)\b/.test(text),
  },
  {
    id: "smoke_chirp",
    label: "battery change",
    tenantAsk:
      "Is the smoke detector chirping, not sounding a full alarm? Replace the battery and tell me if the chirp stops.",
    landlordLine:
      "Quick check: replace the smoke detector battery. Reply FIXED if the chirp stops.",
    steps: [
      "Do this only for a chirp, not a loud alarm.",
      "Open the battery door, or twist the detector off its base.",
      "Put in a fresh battery and close it.",
    ],
    successSignal: /\b(stopped|quiet|chirp(?:ing)? stopped|works)\b/i,
    failureSignal: /\b(still chirp|still beeping|didn't work|did not work)\b/i,
    matches: (text) =>
      /\b(smoke detector|smoke alarm)\b/.test(text) &&
      /\b(chirp|chirping|beep|beeping)\b/.test(text) &&
      !/\b(fire|flames?|burning|going off|full alarm|alarm sounding)\b/.test(text),
  },
  {
    id: "dishwasher_drain",
    label: "dishwasher filter",
    tenantAsk:
      "Is the dishwasher not draining? Clean the filter at the bottom and tell me if the water goes down.",
    landlordLine:
      "Quick check: clean the filter at the bottom of the dishwasher. Reply FIXED if it drains.",
    steps: [
      "Pull out the bottom rack.",
      "Twist out the filter at the bottom and rinse it.",
      "Put the filter back.",
    ],
    successSignal: /\b(drains|drained|went down|works|empty)\b/i,
    failureSignal: /\b(still (?:full|standing)|didn't work|did not work|won't drain)\b/i,
    matches: (text) =>
      /\bdishwasher\b/.test(text) &&
      /\b(not draining|won't drain|will not drain|standing water|water (?:left|in the bottom))\b/.test(text),
  },
  {
    id: "sink_slow_drain",
    label: "stopper check",
    tenantAsk:
      "Is the sink draining slowly? Clear the stopper or strainer and tell me if the water goes down.",
    landlordLine:
      "Quick check: pull out the stopper and rinse it. Reply FIXED if the sink drains.",
    steps: [
      "Pull out the stopper or strainer.",
      "Rinse off hair and food.",
      "Put it back and run the water. Skip store-bought drain cleaner.",
    ],
    successSignal: /\b(drains|drained|goes down|went down|works|faster)\b/i,
    failureSignal: /\b(still slow|still standing|didn't work|did not work)\b/i,
    matches: (text) =>
      /\b(sink|basin)\b/.test(text) &&
      /\b(slow drain|draining slowly|drains slowly|sluggish)\b/.test(text) &&
      !/\b(overflow|sewage|backup)\b/.test(text),
  },
  {
    id: "fridge_not_cooling",
    label: "fridge check",
    tenantAsk:
      "Is the fridge warm? Check that it is plugged in and the dial is not on off or 1, then tell me if it starts cooling.",
    landlordLine:
      "Quick check: plug in the fridge and make sure the dial isn't off. Reply FIXED if it cools.",
    steps: [
      "Check that the plug is all the way in the outlet.",
      "Make sure the dial inside is not set to off or 1.",
      "Wait a bit, then see if it feels cooler.",
    ],
    successSignal: /\b(cooling|colder|works|came on)\b/i,
    failureSignal: /\b(still warm|still hot|didn't work|did not work)\b/i,
    matches: (text) =>
      /\b(fridge|refrigerator)\b/.test(text) &&
      /\b(warm|not cooling|not cold|isn't cold|is not cold)\b/.test(text) &&
      !/\b(freezer.*(warm|thaw)|food spoiling|spoiled)\b/.test(text),
  },
  {
    id: "washer_wont_start",
    label: "washer check",
    tenantAsk:
      "Will the washer not start? Close the lid, pick a cycle, and tell me if it starts.",
    landlordLine:
      "Quick check: close the lid, pick a cycle, and test the outlet. Reply FIXED if it starts.",
    steps: [
      "Close the lid or door until it clicks.",
      "Pick a cycle and press start.",
      "If it stays dark, try that outlet with a small lamp.",
    ],
    successSignal: /\b(starts|started|running|works|came on)\b/i,
    failureSignal: /\b(still (?:won't|dead|nothing)|didn't work|did not work|won't start)\b/i,
    matches: (text) =>
      /\b(washer|washing machine)\b/.test(text) &&
      /\b(won't start|will not start|doesn't start|does not start|not starting|won't turn on)\b/.test(text),
  },
]

const UNSAFE_TOPIC =
  /\b(gas|carbon monoxide|water heater|hot water tank|roof|ladder|ladders|chemical|chemicals|drain cleaner|wiring|open the panel|panel cover off|sewage|sewer)\b/i

const CANT_TRY =
  /\b(elderly|disabled|wheelchair|not safe|unsafe|can'?t safely|cannot safely|unable to try|i can'?t do)\b/i

const OBSERVATION_ORIGINS = new Set([
  "home_check",
  "home check",
  "inspection",
  "observation",
])

function ticketText(ticket: SelfFixTicket): string {
  return (ticket.text ?? "").toLowerCase()
}

/** Chirp only. A sounding alarm stays on the emergency path. */
export function isSmokeChirpOnly(text: string): boolean {
  const hay = text.toLowerCase()
  return (
    /\b(smoke detector|smoke alarm)\b/.test(hay) &&
    /\b(chirp|chirping|beep|beeping)\b/.test(hay) &&
    !/\b(fire|flames?|burning|going off|full alarm|alarm sounding)\b/.test(hay)
  )
}

function isEmergency(text: string, outdoorTempF?: number | null): boolean {
  if (isSmokeChirpOnly(text)) {
    return resolveUrgencyPolicy({
      text,
      outdoorTempF: outdoorTempF ?? undefined,
    }).band === "emergency"
  }
  if (matchEmergencyNet(text)) return true
  return resolveUrgencyPolicy({
    text,
    outdoorTempF: outdoorTempF ?? undefined,
  }).band === "emergency"
}

function isObservation(ticket: SelfFixTicket): boolean {
  if (ticket.observationOnly) return true
  const origin = (ticket.origin ?? "").trim().toLowerCase()
  return OBSERVATION_ORIGINS.has(origin)
}

function alreadyTried(ticket: SelfFixTicket, tipId: string): boolean {
  const facts = ticket.diagnosticFacts ?? {}
  const tried = (facts.self_fix_tried ?? "").trim()
  if (tried && tried === tipId) return true
  const result = (facts.self_fix_result ?? "").trim()
  return result === "fixed" || result === "not_fixed" || result === "skipped"
}

/** Safety and settings blocks. A matching tip can still be named for the landlord line. */
export function selfFixBlocked(ticket: SelfFixTicket): boolean {
  if (ticket.tipsEnabled === false) return true
  if (isObservation(ticket)) return true
  const text = ticketText(ticket)
  if (!text.trim()) return true
  if (CANT_TRY.test(text)) return true
  if (UNSAFE_TOPIC.test(text) && !isSmokeChirpOnly(text)) return true
  if (isEmergency(text, ticket.outdoorTempF)) return true
  return false
}

export function selfFixTipById(id: string | null | undefined): SelfFixTip | null {
  const key = (id ?? "").trim()
  return SELF_FIX_TIPS.find((tip) => tip.id === key) ?? null
}

/** First matching tip, including after the tenant already tried it. */
export function findSelfFixTip(ticket: SelfFixTicket): SelfFixTip | null {
  if (selfFixBlocked(ticket)) return null
  const text = ticketText(ticket)
  return SELF_FIX_TIPS.find((tip) => tip.matches(text)) ?? null
}

/** Tip to ask the tenant. Null when it must not be offered. */
export function shouldOfferSelfFix(ticket: SelfFixTicket): SelfFixTip | null {
  const tip = findSelfFixTip(ticket)
  if (!tip) return null
  if (alreadyTried(ticket, tip.id)) return null
  return tip
}

export function classifySelfFixReply(body: string): SelfFixResult {
  const text = body.trim().toLowerCase()
  if (!text) return "skipped"
  if (
    /\b(can'?t|cannot|unable|don'?t know|dont know|do not know|not sure|no idea)\b/.test(text) ||
    CANT_TRY.test(text)
  ) {
    return "skipped"
  }
  if (
    /\b(didn'?t work|did not work|still out|still dead|still broken|not fixed|no)\b/.test(text)
  ) {
    return "not_fixed"
  }
  if (
    /\b(it works|it's fixed|its fixed|fixed|came back|working now|all good|power(?:'s| is)? back)\b/.test(text)
  ) {
    return "fixed"
  }
  return "skipped"
}

export function tenantSelfFixActivityMessage(tip: SelfFixTip): string {
  const label = tip.id === "gfci_reset" ? "a GFCI reset" : `a ${tip.label}`
  return `Tenant fixed it with ${label} — no vendor needed.`
}

export function landlordFixedTenantSms(issue: string | null | undefined): string {
  const name = (issue ?? "").trim() || "repair"
  return `Your landlord says the ${name} is fixed. Text me if it's still a problem.`
}

/**
 * One landlord approval line, or null.
 * Tenant already fixed it → null (no approval text).
 * Multi-item batches must not call this.
 */
export function selfFixApprovalLine(ticket: SelfFixTicket): string | null {
  if (ticket.tipsEnabled === false) return null
  const facts = ticket.diagnosticFacts ?? {}
  const result = (facts.self_fix_result ?? "").trim()
  if (result === "fixed") return null
  if (result === "not_fixed" || (facts.self_fix_tried ?? "").trim()) {
    const tip = selfFixTipById(facts.self_fix_tip || facts.self_fix_tried) ?? findSelfFixTip({
      ...ticket,
      diagnosticFacts: {},
    })
    return tip ? triedLine(tip.label) : null
  }
  if (ticket.hasTenant === false) {
    const tip = findSelfFixTip(ticket)
    return tip ? tip.landlordLine : null
  }
  return null
}

export function summarizeSelfFixSavings(
  jobs: ReadonlyArray<{ resolution?: string | null; estimate?: number | null }>,
): { count: number; costAvoided: number } {
  let count = 0
  let costAvoided = 0
  for (const job of jobs) {
    if (job.resolution !== "tenant_self_fix" && job.resolution !== "landlord_self_fix") continue
    count += 1
    const estimate = job.estimate
    if (typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0) {
      costAvoided += estimate
    }
  }
  return { count, costAvoided }
}

export function selfFixCopyWithinLimit(): boolean {
  return SELF_FIX_TIPS.every((tip) => {
    const tried = triedLine(tip.label)
    return tip.landlordLine.length <= 90 && tried.length <= 90 && tip.steps.length <= 3 && tip.steps.length > 0
  })
}
