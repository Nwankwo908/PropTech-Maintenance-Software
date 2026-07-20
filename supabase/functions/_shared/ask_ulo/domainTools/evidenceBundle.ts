/**
 * Structured evidence bundle — normalize tool results before synthesis.
 * Do not flatten into generic bullets before this packet exists.
 */

import type { AskUloCapability } from "../capability.ts"
import type { AskUloQuestionSubject } from "../questionSubjectMatch.ts"
import type { DomainToolId } from "./registry.ts"

export type AskUloEvidenceScope = {
  organizationId: string
  propertyId?: string
  unitId?: string
  dateRange?: { from: string; to: string }
}

export type AskUloToolExecution = {
  tool: DomainToolId | string
  arguments: Record<string, unknown>
  resultCount: number
  success: boolean
  error?: string
}

export type WorkOrderEvidence = {
  id: string
  displayId?: string | null
  propertyName?: string | null
  unitLabel?: string | null
  title?: string | null
  description?: string | null
  category?: string | null
  priority?: string | null
  urgency?: string | null
  status?: string | null
  workflowStage?: string | null
  slaState?: string | null
  vendorName?: string | null
  estimate?: number | null
  laborEstimate?: number | null
  approvalRequired?: boolean | null
  completionDate?: string | null
  daysOpen?: number | null
}

export type WorkflowEvidence = {
  id: string
  templateId?: string | null
  status?: string | null
  stage?: string | null
  escalationReason?: string | null
  dueAt?: string | null
  completedAt?: string | null
  maintenanceRequestId?: string | null
  vendorId?: string | null
}

export type PropertyInsightEvidence = {
  tag: string
  text: string
  requestCount?: number | null
  building?: string | null
  unitLabel?: string | null
  categoryLabel?: string | null
}

export type AwaitingDecisionEvidence = {
  kind: string
  label: string
  building?: string | null
  unitLabel?: string | null
  category?: string | null
  reason: string
  priority?: string | null
  ageHours?: number | null
}

export type VendorEvidence = {
  vendorId: string
  name: string
  metric?: string | null
  score?: number | null
  category?: string | null
  completedJobs?: number | null
  acceptedJobs?: number | null
  activeJobs?: number | null
}

export type ResidentEvidenceRow = {
  residentId: string
  name: string
  unitLabel?: string | null
  propertyName?: string | null
  balanceDue?: number | null
  daysOverdue?: number | null
  leaseEndDate?: string | null
  workflowRunId?: string | null
}

export type PropertyEvidence = {
  propertyId?: string | null
  name: string
  metric?: string | null
  score?: number | null
  openWorkOrders?: number | null
}

export type OperationGraphEvidence = {
  eventId?: string
  eventType: string
  occurredAt?: string | null
  summary?: string | null
  maintenanceRequestId?: string | null
  vendorId?: string | null
  residentId?: string | null
}

export type AskUloEvidenceBundle = {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  scope: AskUloEvidenceScope
  toolExecutions: AskUloToolExecution[]
  findings: {
    workOrders?: WorkOrderEvidence[]
    workflows?: WorkflowEvidence[]
    insights?: PropertyInsightEvidence[]
    decisions?: AwaitingDecisionEvidence[]
    vendors?: VendorEvidence[]
    residents?: ResidentEvidenceRow[]
    properties?: PropertyEvidence[]
    events?: OperationGraphEvidence[]
  }
  /** True when at least one finding array has records. */
  hasEvidence: boolean
}

export function emptyEvidenceBundle(input: {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  organizationId: string
  propertyId?: string | null
}): AskUloEvidenceBundle {
  return {
    subject: input.subject,
    capability: input.capability,
    scope: {
      organizationId: input.organizationId,
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    },
    toolExecutions: [],
    findings: {},
    hasEvidence: false,
  }
}

export function recordToolExecution(
  bundle: AskUloEvidenceBundle,
  execution: AskUloToolExecution,
): void {
  bundle.toolExecutions.push(execution)
}

export function finalizeEvidenceBundle(bundle: AskUloEvidenceBundle): AskUloEvidenceBundle {
  const f = bundle.findings
  const hasEvidence = Boolean(
    (f.workOrders && f.workOrders.length > 0) ||
      (f.workflows && f.workflows.length > 0) ||
      (f.insights && f.insights.length > 0) ||
      (f.decisions && f.decisions.length > 0) ||
      (f.vendors && f.vendors.length > 0) ||
      (f.residents && f.residents.length > 0) ||
      (f.properties && f.properties.length > 0) ||
      (f.events && f.events.length > 0),
  )
  return { ...bundle, hasEvidence }
}

/** Compact summary for logging / eval — not for synthesis prose. */
export function summarizeEvidenceBundle(bundle: AskUloEvidenceBundle): Record<string, unknown> {
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(bundle.findings)) {
    if (Array.isArray(v)) counts[k] = v.length
  }
  return {
    subject: bundle.subject,
    capability: bundle.capability,
    hasEvidence: bundle.hasEvidence,
    toolExecutions: bundle.toolExecutions.map((t) => ({
      tool: t.tool,
      resultCount: t.resultCount,
      success: t.success,
    })),
    findingCounts: counts,
  }
}
