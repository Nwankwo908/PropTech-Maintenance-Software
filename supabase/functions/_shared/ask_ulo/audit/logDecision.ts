/**
 * Audit: decision / prefer-packet / quality / refusal console logs.
 * Prefer these helpers over ad-hoc console.log in the core pipeline.
 */

export type AskUloDecisionPayload = Record<string, unknown>

function emit(tag: string, payload: AskUloDecisionPayload): void {
  console.log(tag, JSON.stringify(payload))
}

export function logDecision(tag: string, payload: AskUloDecisionPayload): void {
  emit(tag, payload)
}

export function logIncompleteEvidence(payload: AskUloDecisionPayload): void {
  emit("ASK_ULO_INCOMPLETE_EVIDENCE", payload)
}

export function logPostAnswerQuality(payload: AskUloDecisionPayload): void {
  emit("ASK_ULO_POST_ANSWER_QUALITY", payload)
}

export function logFailureTags(payload: AskUloDecisionPayload): void {
  emit("ASK_ULO_FAILURE_TAGS", payload)
}

export function logFeedbackLoop(payload: AskUloDecisionPayload): void {
  emit("ASK_ULO_FEEDBACK_LOOP", payload)
}

export function logPreferPacket(kind: string, payload: AskUloDecisionPayload = {}): void {
  emit("ASK_ULO_PREFER_PACKET", { kind, ...payload })
}
