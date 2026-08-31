/**
 * Row shape for ai_classification_log. Insert happens at production call sites,
 * never inside classifyMaintenanceRequest.
 */
import type { ClassificationResult } from './classificationTypes.ts'
import type { LandlordTriage } from './landlordTriage.ts'

export const AI_CLASSIFICATION_LOG_TEXT_MAX = 8000

export const AI_CLASSIFICATION_CORRECTION_SOURCES = [
  'ticket_trade_edit',
  'manual_review',
] as const

export type AiClassificationCorrectionSource =
  (typeof AI_CLASSIFICATION_CORRECTION_SOURCES)[number]

export type ClassificationForLog = ClassificationResult & {
  landlordTriage?: LandlordTriage
}

export type AiClassificationLogInput = {
  landlordId: string
  unitId?: string | null
  residentId?: string | null
  conversationId?: string | null
  maintenanceRequestId?: string | null
  rawMessage?: string | null
  result: ClassificationForLog
  latencyMs?: number | null
}

export type AiClassificationLogRow = {
  landlord_id: string
  unit_id: string | null
  resident_id: string | null
  conversation_id: string | null
  maintenance_request_id: string | null
  pipeline_version: string
  raw_message: string
  sanitized_description: string
  vendor_trade: string | null
  primary_category: string | null
  urgency_band: string | null
  confidence_band: string | null
  emergency_type: string | null
  llm_draft: unknown
  llm_provider: string
  landlord_triage: LandlordTriage | null
  latency_ms: number | null
}

function clip(text: string, max = AI_CLASSIFICATION_LOG_TEXT_MAX): string {
  if (text.length <= max) return text
  return text.slice(0, max)
}

function llmProviderFromResult(result: ClassificationForLog): string {
  const fromAudit = result.audit?.llm_provider
  if (typeof fromAudit === 'string' && fromAudit.trim()) return fromAudit.trim()
  return 'none'
}

export function aiClassificationLogRow(
  input: AiClassificationLogInput,
): AiClassificationLogRow {
  const raw = (input.rawMessage ?? input.result.rawDescription ?? '').trim()
  return {
    landlord_id: input.landlordId,
    unit_id: input.unitId ?? null,
    resident_id: input.residentId ?? null,
    conversation_id: input.conversationId ?? null,
    maintenance_request_id: input.maintenanceRequestId ?? null,
    pipeline_version: input.result.pipelineVersion,
    raw_message: clip(raw),
    sanitized_description: clip(input.result.sanitizedDescription ?? ''),
    vendor_trade: input.result.vendorTrade ?? null,
    primary_category: input.result.primaryCategory ?? null,
    urgency_band: input.result.urgencyBand ?? null,
    confidence_band: input.result.confidenceBand ?? null,
    emergency_type: input.result.emergencyType ?? null,
    llm_draft: input.result.audit?.llm ?? null,
    llm_provider: llmProviderFromResult(input.result),
    landlord_triage: input.result.landlordTriage ?? null,
    latency_ms: input.latencyMs ?? null,
  }
}

/**
 * Ticket trade edits on this work order are gold. Changing assigned vendor
 * is not a classification correction.
 */
export function shouldApplyTicketTradeCorrection(params: {
  previousIssueCategory: string | null | undefined
  nextIssueCategory: string | null | undefined
  predictedVendorTrade: string | null | undefined
}): boolean {
  const next = (params.nextIssueCategory ?? '').trim()
  if (!next) return false
  const previous = (params.previousIssueCategory ?? '').trim()
  if (next === previous) return false
  const predicted = (params.predictedVendorTrade ?? '').trim()
  return predicted !== next
}
