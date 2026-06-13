import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  fetchWorkflowTemplateConfig,
  type WorkflowTemplateConfigRow,
} from "./templateConfig.ts"
import type { WorkflowRunRow } from "./types.ts"
import { escalateRentCollectionRun } from "./rentCollectionEscalation.ts"
import {
  findActiveWorkflowRunsForLandlord,
  runDueAt,
  runLeaseEndDate,
  runStepState,
  updateWorkflowRun,
} from "./workflowRuns.ts"

/** Steps where the workflow is waiting on tenant, vendor, or admin action. */
const WAITING_STEPS = new Set([
  "initiated",
  "awaiting_response",
  "awaiting_payment",
  "payment_reminder_sent",
  "routed",
  "collecting",
  "awaiting_confirm",
  "awaiting_edit_selection",
  "pending_accept",
])

export type EscalationCandidate = {
  run: WorkflowRunRow
  template: WorkflowTemplateConfigRow
  reason: string
  overdue_by_ms: number
}

export type WorkflowEscalationResult = {
  workflow_run_id: string
  template_id: string
  reason: string
  notified: string[]
  notify_errors: string[]
}

export type RunWorkflowEscalationsResult = {
  landlord_id: string
  candidates: number
  escalated: number
  skipped: number
  escalations: WorkflowEscalationResult[]
  errors: Array<{ workflow_run_id: string; error: string }>
}

function positiveInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function escalationNotifyEmails(): string[] {
  const raw = Deno.env.get("WORKFLOW_ESCALATION_NOTIFY_EMAILS")?.trim() ??
    Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS")?.trim()
  if (raw) {
    return raw.split(",").map((e) => e.trim()).filter(Boolean)
  }
  return ["emeka@ulohome.io", "osi@ulohome.io"]
}

export function isWaitingWorkflowRun(run: WorkflowRunRow): boolean {
  const step = run.current_step?.trim()
  if (step && WAITING_STEPS.has(step)) return true

  const state = runStepState<{ step?: string }>(run)
  const stateStep = state.step?.trim()
  return !!(stateStep && WAITING_STEPS.has(stateStep))
}

/** Resolve escalation deadline from metadata.due_at or started_at + no_response_days. */
export function resolveEscalationDeadline(
  run: WorkflowRunRow,
  escalationConfig: Record<string, unknown>,
): Date | null {
  const dueAt = runDueAt(run)
  if (dueAt) {
    const parsed = new Date(dueAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const noResponseDays = positiveInt(escalationConfig.no_response_days, 0)
  if (!noResponseDays) return null

  const started = new Date(run.started_at)
  if (Number.isNaN(started.getTime())) return null

  const deadline = new Date(started)
  deadline.setDate(deadline.getDate() + noResponseDays)
  return deadline
}

export function isEscalationDue(
  run: WorkflowRunRow,
  escalationConfig: Record<string, unknown>,
): { due: boolean; reason: string; overdueByMs: number } {
  const deadline = resolveEscalationDeadline(run, escalationConfig)
  if (!deadline) {
    return { due: false, reason: "no_escalation_threshold", overdueByMs: 0 }
  }

  const overdueByMs = Date.now() - deadline.getTime()
  if (overdueByMs <= 0) {
    return { due: false, reason: "within_threshold", overdueByMs: 0 }
  }

  const dueAt = runDueAt(run)
  const reason = dueAt
    ? "no_response_by_due_at"
    : "no_response_by_no_response_days"

  return { due: true, reason, overdueByMs }
}

function graphEventTypeForTemplate(templateId: string): string {
  switch (templateId) {
    case "lease_renewal":
      return "lease.renewal_escalated"
    case "maintenance_intake":
      return "maintenance.intake_escalated"
    case "rent_collection":
      return "rent.late_escalated"
    default:
      return "workflow.escalated"
  }
}

async function loadTemplateConfigMap(
  supabase: SupabaseClient,
  templateIds: string[],
): Promise<Map<string, WorkflowTemplateConfigRow>> {
  const map = new Map<string, WorkflowTemplateConfigRow>()
  const unique = [...new Set(templateIds)]

  await Promise.all(
    unique.map(async (id) => {
      const config = await fetchWorkflowTemplateConfig(supabase, id)
      if (config) map.set(id, config)
    }),
  )

  return map
}

export async function findEscalationCandidates(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EscalationCandidate[]> {
  const runs = await findActiveWorkflowRunsForLandlord(supabase, landlordId)
  const waiting = runs.filter(isWaitingWorkflowRun)
  if (!waiting.length) return []

  const templates = await loadTemplateConfigMap(
    supabase,
    waiting.map((run) => run.template_id),
  )

  const candidates: EscalationCandidate[] = []

  for (const run of waiting) {
    const template = templates.get(run.template_id)
    if (!template) continue

    const { due, reason, overdueByMs } = isEscalationDue(
      run,
      template.escalation_config,
    )
    if (!due) continue

    candidates.push({
      run,
      template,
      reason,
      overdue_by_ms: overdueByMs,
    })
  }

  return candidates
}

async function notifyLandlordAdmin(
  params: {
    emails: string[]
    subject: string
    text: string
    html: string
  },
): Promise<{ notified: string[]; errors: string[] }> {
  const notified: string[] = []
  const errors: string[] = []

  for (const email of params.emails) {
    const result = await sendResendEmail(
      email,
      params.subject,
      params.text,
      params.html,
    )
    if ("error" in result) {
      errors.push(`${email}: ${result.error}`)
    } else {
      notified.push(email)
    }
  }

  return { notified, errors: errors }
}

function buildEscalationEmail(
  run: WorkflowRunRow,
  template: WorkflowTemplateConfigRow,
  reason: string,
): { subject: string; text: string; html: string } {
  const action = readString(template.escalation_config.action) ?? "notify_landlord"
  const label = readString(template.escalation_config.label) ??
    "Workflow response threshold exceeded"
  const leaseEnd = runLeaseEndDate(run)
  const residentId = run.resident_id ?? "—"
  const step = run.current_step ?? runStepState<{ step?: string }>(run).step ?? "—"

  const subject = `[Ulo] Workflow escalation: ${template.name}`
  const text = [
    label,
    "",
    `Template: ${template.name} (${template.id})`,
    `Workflow run: ${run.id}`,
    `Waiting step: ${step}`,
    `Escalation action: ${action}`,
    `Reason: ${reason}`,
    leaseEnd ? `Lease end date: ${leaseEnd}` : null,
    residentId !== "—" ? `Resident: ${residentId}` : null,
    "",
    "Review this workflow in the admin dashboard.",
  ].filter(Boolean).join("\n")

  const html = `<p>${label}</p>
<ul>
<li><strong>Template:</strong> ${template.name} (${template.id})</li>
<li><strong>Workflow run:</strong> ${run.id}</li>
<li><strong>Waiting step:</strong> ${step}</li>
<li><strong>Escalation action:</strong> ${action}</li>
<li><strong>Reason:</strong> ${reason}</li>
${leaseEnd ? `<li><strong>Lease end:</strong> ${leaseEnd}</li>` : ""}
${residentId !== "—" ? `<li><strong>Resident:</strong> ${residentId}</li>` : ""}
</ul>
<p>Review this workflow in the admin dashboard.</p>`

  return { subject, text, html }
}

/** Escalate one overdue workflow run: workflow_event, graph event, admin email, status update. */
export async function escalateWorkflowRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    candidate: EscalationCandidate
  },
): Promise<WorkflowEscalationResult> {
  const { run, template, reason } = params.candidate
  const now = new Date().toISOString()
  const escalationAction = readString(template.escalation_config.action) ??
    "notify_landlord"

  await updateWorkflowRun(supabase, run.id, {
    status: "escalated",
    currentStep: "escalated",
    metadata: {
      escalated_at: now,
      escalation_reason: reason,
      escalation_action: escalationAction,
    },
    pipelineStage: "escalate",
    eventMessage: reason,
    eventStep: "escalated",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: graphEventTypeForTemplate(template.id),
    source: "automation",
    actor_type: "system",
    resident_id: run.resident_id,
    unit_id: run.unit_id,
    workflow_run_id: run.id,
    workflow_template_id: template.id,
    metadata: {
      reason,
      escalation_action: escalationAction,
      escalation_config: template.escalation_config,
      overdue_by_ms: params.candidate.overdue_by_ms,
      lease_end_date: runLeaseEndDate(run),
      waiting_step: run.current_step,
    },
  })

  const email = buildEscalationEmail(run, template, reason)
  const { notified, errors: notifyErrors } = await notifyLandlordAdmin({
    emails: escalationNotifyEmails(),
    ...email,
  })

  if (notifyErrors.length) {
    console.error("[run-workflow-escalations] notify failed", {
      workflowRunId: run.id,
      notifyErrors,
    })
  }

  return {
    workflow_run_id: run.id,
    template_id: template.id,
    reason,
    notified,
    notify_errors: notifyErrors,
  }
}

/**
 * Scheduled escalation sweep: find waiting runs past escalation_config threshold,
 * log workflow.escalate, notify landlord/admin, mark run escalated.
 */
export async function runWorkflowEscalations(
  supabase: SupabaseClient,
  params: { landlordId: string },
): Promise<RunWorkflowEscalationsResult> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "workflow.escalation_cron_triggered",
    source: "automation",
    actor_type: "system",
    metadata: { source: "run-workflow-escalations" },
  })

  const candidates = await findEscalationCandidates(supabase, params.landlordId)
  const activeRuns = await findActiveWorkflowRunsForLandlord(
    supabase,
    params.landlordId,
  )
  const waitingCount = activeRuns.filter(isWaitingWorkflowRun).length

  const escalations: WorkflowEscalationResult[] = []
  const errors: RunWorkflowEscalationsResult["errors"] = []

  for (const candidate of candidates) {
    try {
      if (candidate.run.template_id === "rent_collection") {
        const rentResult = await escalateRentCollectionRun(supabase, {
          landlordId: params.landlordId,
          run: candidate.run,
          reason: candidate.reason,
        })
        if (rentResult) {
          escalations.push({
            workflow_run_id: rentResult.workflow_run_id,
            template_id: "rent_collection",
            reason: candidate.reason,
            notified: rentResult.admin_notified,
            notify_errors: rentResult.admin_notify_errors,
          })
        }
        continue
      }

      const result = await escalateWorkflowRun(supabase, {
        landlordId: params.landlordId,
        candidate,
      })
      escalations.push(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ workflow_run_id: candidate.run.id, error: message })
    }
  }

  return {
    landlord_id: params.landlordId,
    candidates: candidates.length,
    escalated: escalations.length,
    skipped: Math.max(0, waitingCount - candidates.length),
    escalations,
    errors,
  }
}
