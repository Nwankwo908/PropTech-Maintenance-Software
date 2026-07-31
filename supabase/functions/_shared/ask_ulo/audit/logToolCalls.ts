/**
 * Audit: tool / routing / evidence console logs.
 * Prefer these helpers over ad-hoc console.log in the core pipeline.
 */

export type AskUloLogPayload = Record<string, unknown>

function emit(tag: string, payload: AskUloLogPayload): void {
  console.log(tag, JSON.stringify(payload))
}

export function logToolSelect(payload: AskUloLogPayload): void {
  emit("ASK_ULO_TOOL_SELECT", payload)
}

export function logToolsCalled(payload: AskUloLogPayload): void {
  emit("ASK_ULO_TOOLS_CALLED", payload)
}

export function logCapabilityRoute(payload: AskUloLogPayload): void {
  emit("ASK_ULO_CAPABILITY_ROUTE", payload)
}

export function logEpistemicBucket(payload: AskUloLogPayload): void {
  emit("ASK_ULO_EPISTEMIC_BUCKET", payload)
}

export function logPlaybook(payload: AskUloLogPayload): void {
  emit("ASK_ULO_PLAYBOOK", payload)
}

export function logRouteDecision(payload: AskUloLogPayload): void {
  emit("ASK_ULO_ROUTE", payload)
}

export function logPortfolioJurisdiction(payload: AskUloLogPayload): void {
  emit("ASK_ULO_PORTFOLIO_JURISDICTION", payload)
}

export function logEvidenceBundle(payload: AskUloLogPayload): void {
  emit("ASK_ULO_EVIDENCE_BUNDLE", payload)
}

export function logEvidencePacket(payload: AskUloLogPayload): void {
  emit("ASK_ULO_EVIDENCE_PACKET", payload)
}

export function logCatchAllFallback(payload: AskUloLogPayload): void {
  emit("ASK_ULO_CATCHALL_FALLBACK", payload)
}

/** Generic tagged tool log (lookups may use domain-specific tags). */
export function logToolCall(tag: string, payload: AskUloLogPayload): void {
  emit(tag, payload)
}
