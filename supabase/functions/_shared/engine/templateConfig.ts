import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type WorkflowTemplateConfigRow = {
  id: string
  name: string
  type: string
  trigger_config: Record<string, unknown>
  route_config: Record<string, unknown>
  escalation_config: Record<string, unknown>
  active: boolean
}

const templateSelect =
  "id, name, type, trigger_config, route_config, escalation_config, active"

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

export async function fetchWorkflowTemplateConfig(
  supabase: SupabaseClient,
  templateId: string,
): Promise<WorkflowTemplateConfigRow | null> {
  const { data, error } = await supabase
    .from("workflow_templates")
    .select(templateSelect)
    .eq("id", templateId)
    .maybeSingle()

  if (error) {
    console.error("[workflow-templates] fetch", templateId, error.message)
    return null
  }

  if (!data) return null

  return {
    id: String(data.id),
    name: String(data.name),
    type: String(data.type),
    trigger_config:
      data.trigger_config && typeof data.trigger_config === "object"
        ? (data.trigger_config as Record<string, unknown>)
        : {},
    route_config:
      data.route_config && typeof data.route_config === "object"
        ? (data.route_config as Record<string, unknown>)
        : {},
    escalation_config:
      data.escalation_config && typeof data.escalation_config === "object"
        ? (data.escalation_config as Record<string, unknown>)
        : {},
    active: Boolean(data.active),
  }
}

export async function fetchActiveWorkflowTemplate(
  supabase: SupabaseClient,
  templateId: string,
): Promise<WorkflowTemplateConfigRow | null> {
  const config = await fetchWorkflowTemplateConfig(supabase, templateId)
  if (!config) return null
  if (!config.active) return null
  return config
}

export function leaseRenewalTimingFromConfig(
  config: WorkflowTemplateConfigRow | null,
  overrides?: { noticeDays?: number; noResponseDays?: number },
): { noticeDays: number; noResponseDays: number } {
  const noticeDays = overrides?.noticeDays ??
    positiveInt(config?.trigger_config?.days_before_expiry, 60)
  const noResponseDays = overrides?.noResponseDays ??
    positiveInt(config?.escalation_config?.no_response_days, 7)

  return { noticeDays, noResponseDays }
}

export function rentCollectionTimingFromConfig(
  config: WorkflowTemplateConfigRow | null,
  overrides?: {
    rentDueDay?: number
    latePaymentGraceDays?: number
  },
): { rentDueDay: number; latePaymentGraceDays: number } {
  const rentDueDay = overrides?.rentDueDay ??
    positiveInt(config?.trigger_config?.rent_due_day, 1)
  const latePaymentGraceDays = overrides?.latePaymentGraceDays ??
    positiveInt(config?.escalation_config?.late_payment_grace_days, 3)

  return { rentDueDay, latePaymentGraceDays }
}

/** Deadline for late-payment escalation: end of rent due date + grace days. */
export function rentCollectionEscalationDeadline(
  rentDueDateIso: string,
  graceDays: number,
): string {
  const deadline = new Date(`${rentDueDateIso}T23:59:59`)
  deadline.setDate(deadline.getDate() + graceDays)
  return deadline.toISOString()
}

/** Load all active lifecycle templates (move_in, move_out, inspection). */
export async function fetchLifecycleWorkflowTemplates(
  supabase: SupabaseClient,
): Promise<WorkflowTemplateConfigRow[]> {
  const { data, error } = await supabase
    .from("workflow_templates")
    .select(templateSelect)
    .in("id", ["move_in", "move_out", "inspection"])
    .eq("active", true)

  if (error) {
    console.error("[workflow-templates] fetch lifecycle", error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    trigger_config:
      row.trigger_config && typeof row.trigger_config === "object"
        ? (row.trigger_config as Record<string, unknown>)
        : {},
    route_config:
      row.route_config && typeof row.route_config === "object"
        ? (row.route_config as Record<string, unknown>)
        : {},
    escalation_config:
      row.escalation_config && typeof row.escalation_config === "object"
        ? (row.escalation_config as Record<string, unknown>)
        : {},
    active: Boolean(row.active),
  }))
}
