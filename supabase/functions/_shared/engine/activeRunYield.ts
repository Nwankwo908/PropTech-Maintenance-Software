/**
 * When an active non-maintenance workflow run is pinned to a conversation,
 * decide whether a clearly classified unrelated inbound should break that pin.
 *
 * Rent collection must only absorb PAID/PARTIAL/QUESTIONS (and near-equivalents),
 * not a repair description that already classified as maintenance_new.
 */
import { hasProblemSignal } from "../../../../shared/maintenance/deterministicRules.ts"
import type { InboundInterpretation } from "../sms/inboundInterpretation.ts"
import { isRepairRecognition } from "../sms/recognizeInboundIntent.ts"
import { parseTenantRentReply } from "../sms/tenantRentReplyParse.ts"
import type { WorkflowTemplateId } from "./types.ts"

/** Minimum recognizer confidence to override an active rent/lease pin. */
export const ACTIVE_RUN_YIELD_MIN_CONFIDENCE = 0.55

const MAINTENANCE_BREAKOUT_INTENTS = new Set([
  "maintenance_new",
  "maintenance_status",
  "maintenance_update",
  "maintenance_cancel",
  "schedule_change",
  "access_instruction",
  "move_out_intent",
])

export function interpretationConfidence(
  interpretation: InboundInterpretation | null | undefined,
): number {
  const fromRecognition = interpretation?.recognition?.confidence
  if (typeof fromRecognition === "number" && Number.isFinite(fromRecognition)) {
    return fromRecognition
  }
  if (!interpretation?.intent) return 0
  // Heuristic / LLM intents without an explicit score still count as usable.
  if (interpretation.source === "heuristic" || interpretation.source === "llm") {
    return 0.7
  }
  return 0
}

/** True when inbound is a plausible answer to a rent-reminder ask. */
export function isPlausibleRentCollectionReply(body: string): boolean {
  return parseTenantRentReply(body) != null
}

/**
 * Clear maintenance / move-out style intent that should not be absorbed by
 * an active rent_collection (or similar) run.
 */
export function hasClearUnrelatedMaintenanceIntent(
  interpretation: InboundInterpretation | null | undefined,
): boolean {
  if (!interpretation) return false
  const conf = interpretationConfidence(interpretation)
  if (conf < ACTIVE_RUN_YIELD_MIN_CONFIDENCE) return false

  const intent = interpretation.intent
  if (intent && MAINTENANCE_BREAKOUT_INTENTS.has(intent)) return true

  const recognition = interpretation.recognition
  if (recognition && isRepairRecognition(recognition) && recognition.confidence >= ACTIVE_RUN_YIELD_MIN_CONFIDENCE) {
    return true
  }
  return false
}

/**
 * Whether the active workflow pin should yield so classification can pick
 * maintenance_intake (or another template) for this inbound.
 */
export function activeNonMaintenanceRunShouldYield(input: {
  activeTemplateId: string | null | undefined
  body: string
  interpretation: InboundInterpretation | null | undefined
  mediaCount?: number
}): boolean {
  const templateId = (input.activeTemplateId ?? "").trim() as WorkflowTemplateId | ""
  if (!templateId) return false
  if (
    templateId === "maintenance_intake" ||
    templateId === "maintenance_request" ||
    templateId === "vendor_job_response" ||
    templateId === "inspection" ||
    templateId === "home_check"
  ) {
    return false
  }

  const mediaCount = input.mediaCount ?? 0

  if (templateId === "rent_collection") {
    if (isPlausibleRentCollectionReply(input.body)) return false
    if (mediaCount > 0) return true
    if (hasProblemSignal(input.body)) return true
    return hasClearUnrelatedMaintenanceIntent(input.interpretation)
  }

  if (templateId === "lease_renewal") {
    if (/^(yes|y|no|n|questions)\b/i.test(input.body.trim())) return false
    if (mediaCount > 0) return true
  }

  if (
    (templateId === "move_in" || templateId === "move_out") &&
    mediaCount > 0 &&
    !input.body.trim()
  ) {
    return true
  }

  // Lease / inspection / other lifecycle pins: yield for a clear repair ask.
  if (hasClearUnrelatedMaintenanceIntent(input.interpretation)) {
    // Keep rent-shaped keyword replies on rent when somehow pinned elsewhere.
    if (isPlausibleRentCollectionReply(input.body)) return false
    return true
  }
  return false
}

/**
 * Whether an existing rent_collection run may keep this inbound.
 * Paused rent never claims a non-rent message. Explicit PAID / PARTIAL /
 * QUESTIONS stay claimed so the paused-ack path can answer them.
 * Repair text and photos are not rent replies, even without an interpretation.
 * The run row is left in place either way.
 */
export function rentCollectionShouldStayPinned(input: {
  body: string
  interpretation: InboundInterpretation | null | undefined
  mediaCount?: number
  rentPaused: boolean
}): boolean {
  if (isPlausibleRentCollectionReply(input.body)) return true
  if (input.rentPaused) return false
  if ((input.mediaCount ?? 0) > 0) return false
  if (
    activeNonMaintenanceRunShouldYield({
      activeTemplateId: "rent_collection",
      body: input.body,
      interpretation: input.interpretation,
    })
  ) {
    return false
  }
  return true
}

/** The PAID / PARTIAL / QUESTIONS fallback. Not used when rent is paused or the text is a repair. */
export function shouldSendRentInvalidReplyFallback(input: {
  body: string
  rentPaused: boolean
  mediaCount?: number
  interpretation?: InboundInterpretation | null
}): boolean {
  return rentCollectionShouldStayPinned({
    body: input.body,
    interpretation: input.interpretation,
    mediaCount: input.mediaCount,
    rentPaused: input.rentPaused,
  }) && !isPlausibleRentCollectionReply(input.body)
}
