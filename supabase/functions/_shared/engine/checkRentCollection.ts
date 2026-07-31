import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  currentBillingPeriod,
  isRentDueDateReached,
  rentDueDateIso,
} from "./templates/rentCollection.ts"
import type { RentCollectionClassification } from "./rentCollectionClassify.ts"
import {
  fetchWorkflowTemplateConfig,
  rentCollectionTimingFromConfig,
} from "./templateConfig.ts"
import { runRentCollectionCronViaEngine } from "./rentCollectionEngine.ts"

export type RentDueResidentRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  unit: string | null
  building: string | null
  balance_due: number
}

export type RentCollectionStartResult = {
  resident_id: string
  billing_period: string
  amount_due: number
  workflow_run_id: string
  workflow_type: "rent_collection"
  rent_classification: RentCollectionClassification
  stage: "routed" | "awaiting_payment"
  sms_sent: boolean
  email_sent: boolean
  route_channels: string[]
  payment_link: string | null
  payment_requested: boolean
}

export type CheckRentCollectionResult = {
  landlord_id: string
  billing_period: string
  rent_due_date: string
  rent_due_day: number
  late_payment_grace_days: number
  rent_due_window: boolean
  candidates: number
  started: number
  skipped: number
  reminders_sent: number
  late_payment_escalated: number
  started_runs: RentCollectionStartResult[]
  errors: Array<{ resident_id: string; billing_period: string; error: string }>
}

/** Active residents with balance_due > 0 (rent due or overdue once due date reached). */
export async function findRentDueResidents(
  supabase: SupabaseClient,
): Promise<RentDueResidentRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit, building, balance_due, status")
    .eq("status", "active")
    .gt("balance_due", 0)

  if (error) {
    console.error("[check-rent-collection] residents query", error.message)
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: row.full_name == null ? null : String(row.full_name),
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    unit: row.unit == null ? null : String(row.unit),
    building: row.building == null ? null : String(row.building),
    balance_due: Number(row.balance_due ?? 0),
  }))
}

/** Skip when an active rent_collection run already exists for this billing period. */
export async function hasActiveRentCollectionForPeriod(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    billingPeriod: string
  },
): Promise<boolean> {
  const { findActiveWorkflowRun, runBillingPeriod } = await import("./workflowRuns.ts")
  const existing = await findActiveWorkflowRun(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    templateId: "rent_collection",
  })

  if (!existing) return false
  return runBillingPeriod(existing) === params.billingPeriod
}

/**
 * Daily rent collection cron — runs through the official workflow engine
 * (trigger → classify → route → act → escalate → log).
 */
export async function checkRentCollection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    rentDueDay?: number
    latePaymentGraceDays?: number
  },
): Promise<CheckRentCollectionResult> {
  const templateConfig = await fetchWorkflowTemplateConfig(supabase, "rent_collection")
  const timing = rentCollectionTimingFromConfig(templateConfig, {
    rentDueDay: params.rentDueDay,
    latePaymentGraceDays: params.latePaymentGraceDays,
  })

  const billingPeriod = currentBillingPeriod()
  const rentDueDate = rentDueDateIso(timing.rentDueDay)
  const rentDueWindow = isRentDueDateReached(timing.rentDueDay)

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "rent.collection_cron_triggered",
    source: "automation",
    actor_type: "system",
    workflow_template_id: "rent_collection",
    metadata: {
      billing_period: billingPeriod,
      rent_due_day: timing.rentDueDay,
      rent_due_date: rentDueDate,
      rent_due_window: rentDueWindow,
      late_payment_grace_days: timing.latePaymentGraceDays,
      source: "check-rent-collection",
    },
  })

  const emptyResult: CheckRentCollectionResult = {
    landlord_id: params.landlordId,
    billing_period: billingPeriod,
    rent_due_date: rentDueDate,
    rent_due_day: timing.rentDueDay,
    late_payment_grace_days: timing.latePaymentGraceDays,
    rent_due_window: rentDueWindow,
    candidates: 0,
    started: 0,
    skipped: 0,
    reminders_sent: 0,
    late_payment_escalated: 0,
    started_runs: [],
    errors: [],
  }

  if (!rentDueWindow) {
    return emptyResult
  }

  const engineResult = await runRentCollectionCronViaEngine(supabase, {
    landlordId: params.landlordId,
    rentDueDay: timing.rentDueDay,
    latePaymentGraceDays: timing.latePaymentGraceDays,
  })

  const meta = engineResult.metadata ?? {}

  return {
    ...emptyResult,
    rent_due_window: true,
    candidates: Number(meta.candidates ?? 0),
    started: Number(meta.started ?? 0),
    skipped: Number(meta.skipped ?? 0),
    reminders_sent: Number(meta.reminders_sent ?? 0),
    late_payment_escalated: Number(meta.late_payment_escalated ?? 0),
    started_runs: Array.isArray(meta.started_runs)
      ? (meta.started_runs as RentCollectionStartResult[])
      : [],
    errors: Array.isArray(meta.errors)
      ? (meta.errors as CheckRentCollectionResult["errors"])
      : [],
  }
}
