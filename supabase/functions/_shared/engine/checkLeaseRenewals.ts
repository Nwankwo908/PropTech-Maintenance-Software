import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { invokeWorkflowEngine } from "./invokeWorkflow.ts"
import {
  fetchWorkflowTemplateConfig,
  leaseRenewalTimingFromConfig,
} from "./templateConfig.ts"
import type { InvokeWorkflowResult, WorkflowNextAction } from "./types.ts"
import {
  findActiveWorkflowRun,
  runLeaseEndDate,
} from "./workflowRuns.ts"

export type ExpiringResidentRow = {
  id: string
  full_name: string | null
  phone: string | null
  unit: string | null
  building: string | null
  lease_end_date: string
}

export type LeaseRenewalStartResult = {
  resident_id: string
  lease_end_date: string
  workflow_run_id: string
  next_action: WorkflowNextAction
  invoke: InvokeWorkflowResult
}

export type CheckLeaseRenewalsResult = {
  landlord_id: string
  notice_days: number
  no_response_days: number
  candidates: number
  started: number
  skipped: number
  started_runs: LeaseRenewalStartResult[]
  errors: Array<{ resident_id: string; lease_end_date: string; error: string }>
}

function horizonDates(noticeDays: number): { todayIso: string; horizonIso: string } {
  const today = new Date()
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + noticeDays)

  return {
    todayIso: today.toISOString().slice(0, 10),
    horizonIso: horizon.toISOString().slice(0, 10),
  }
}

/** Active residents whose lease_end_date falls within the notice window (inclusive). */
export async function findExpiringResidents(
  supabase: SupabaseClient,
  noticeDays: number,
): Promise<ExpiringResidentRow[]> {
  const { todayIso, horizonIso } = horizonDates(noticeDays)

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, phone, unit, building, lease_end_date, status")
    .eq("status", "active")
    .not("lease_end_date", "is", null)
    .gte("lease_end_date", todayIso)
    .lte("lease_end_date", horizonIso)

  if (error) {
    console.error("[check-lease-renewals] residents query", error.message)
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: row.full_name == null ? null : String(row.full_name),
    phone: row.phone == null ? null : String(row.phone),
    unit: row.unit == null ? null : String(row.unit),
    building: row.building == null ? null : String(row.building),
    lease_end_date: String(row.lease_end_date),
  }))
}

/** Skip when an active lease_renewal run already exists for this resident + lease end date. */
export async function hasActiveLeaseRenewalForLease(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    leaseEndDate: string
  },
): Promise<boolean> {
  const existing = await findActiveWorkflowRun(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    templateId: "lease_renewal",
  })

  if (!existing) return false
  return runLeaseEndDate(existing) === params.leaseEndDate
}

/** Start one lease renewal run via the shared invokeWorkflowEngine entry point. */
export async function startLeaseRenewalWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    resident: ExpiringResidentRow
    noResponseDays: number
  },
): Promise<LeaseRenewalStartResult> {
  const leaseEnd = params.resident.lease_end_date
  const dueAt = new Date()
  dueAt.setDate(dueAt.getDate() + params.noResponseDays)

  const invoke = await invokeWorkflowEngine(supabase, {
    template_type: "lease_renewal",
    entity_type: "user",
    entity_id: params.resident.id,
    landlord_id: params.landlordId,
    resident_id: params.resident.id,
    trigger_type: "cron",
    metadata: {
      lease_end_date: leaseEnd,
      due_at: dueAt.toISOString(),
      unit_label: params.resident.unit,
      building: params.resident.building,
      step_state: {
        step: "initiated",
        lease_end_date: leaseEnd,
        unit_label: params.resident.unit,
      },
      cron_source: "check-lease-renewals",
    },
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "lease.renewal_started",
    source: "automation",
    actor_type: "system",
    resident_id: params.resident.id,
    workflow_run_id: invoke.workflow_run_id,
    workflow_template_id: "lease_renewal",
    metadata: {
      lease_end_date: leaseEnd,
      unit: params.resident.unit,
      building: params.resident.building,
      next_action: invoke.next_action,
      invoke_source: "check-lease-renewals",
    },
  })

  return {
    resident_id: params.resident.id,
    lease_end_date: leaseEnd,
    workflow_run_id: invoke.workflow_run_id,
    next_action: invoke.next_action,
    invoke,
  }
}

/**
 * Scheduled lease renewal check: find expiring leases, invoke workflow engine per resident,
 * skip duplicates for the same lease end date.
 */
export async function checkLeaseRenewals(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    noticeDays?: number
    noResponseDays?: number
  },
): Promise<CheckLeaseRenewalsResult> {
  const templateConfig = await fetchWorkflowTemplateConfig(supabase, "lease_renewal")
  const timing = leaseRenewalTimingFromConfig(templateConfig, {
    noticeDays: params.noticeDays,
    noResponseDays: params.noResponseDays,
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "lease.renewal_cron_triggered",
    source: "automation",
    actor_type: "system",
    workflow_template_id: "lease_renewal",
    metadata: {
      notice_days: timing.noticeDays,
      no_response_days: timing.noResponseDays,
      source: "check-lease-renewals",
    },
  })

  const residents = await findExpiringResidents(supabase, timing.noticeDays)

  let started = 0
  let skipped = 0
  const startedRuns: LeaseRenewalStartResult[] = []
  const errors: CheckLeaseRenewalsResult["errors"] = []

  for (const resident of residents) {
    const duplicate = await hasActiveLeaseRenewalForLease(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      leaseEndDate: resident.lease_end_date,
    })

    if (duplicate) {
      skipped++
      continue
    }

    try {
      const result = await startLeaseRenewalWorkflow(supabase, {
        landlordId: params.landlordId,
        resident,
        noResponseDays: timing.noResponseDays,
      })
      startedRuns.push(result)
      started++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[check-lease-renewals] start failed", {
        residentId: resident.id,
        leaseEnd: resident.lease_end_date,
        error: message,
      })
      errors.push({
        resident_id: resident.id,
        lease_end_date: resident.lease_end_date,
        error: message,
      })
    }
  }

  return {
    landlord_id: params.landlordId,
    notice_days: timing.noticeDays,
    no_response_days: timing.noResponseDays,
    candidates: residents.length,
    started,
    skipped,
    started_runs: startedRuns,
    errors,
  }
}
