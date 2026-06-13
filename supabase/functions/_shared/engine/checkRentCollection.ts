import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  currentBillingPeriod,
  executeRentCollectionRouteAndAct,
  isRentDueDateReached,
  rentDueDateIso,
  type RentCollectionResident,
  type RentCollectionState,
} from "./templates/rentCollection.ts"
import {
  fetchWorkflowTemplateConfig,
  rentCollectionEscalationDeadline,
  rentCollectionTimingFromConfig,
} from "./templateConfig.ts"
import {
  createWorkflowRun,
  findActiveWorkflowRun,
  logWorkflowEvent,
  runBillingPeriod,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import {
  buildRentClassificationMetadata,
  classifyRentCollection,
  type RentCollectionClassification,
} from "./rentCollectionClassify.ts"
import {
  logRentCollectionGraphEvent,
  logRentCollectionLedgerWithGraph,
  rentCollectionGraphScopeFromResident,
  RENT_GRAPH_EVENTS,
} from "./rentCollectionGraph.ts"

export type RentDueResidentRow = RentCollectionResident

export type RentCollectionStartResult = {
  resident_id: string
  billing_period: string
  amount_due: number
  workflow_run_id: string
  workflow_type: "rent_collection"
  rent_classification: RentCollectionClassification
  stage: "routed"
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
  const existing = await findActiveWorkflowRun(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    templateId: "rent_collection",
  })

  if (!existing) return false
  return runBillingPeriod(existing) === params.billingPeriod
}

/**
 * Start one rent_collection run: create run → rent.due_detected → SMS/email → stage routed.
 */
export async function startRentCollectionWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    resident: RentDueResidentRow
    billingPeriod: string
    rentDueDate: string
    latePaymentGraceDays: number
  },
): Promise<RentCollectionStartResult> {
  const amountDue = params.resident.balance_due
  const dueAt = rentCollectionEscalationDeadline(
    params.rentDueDate,
    params.latePaymentGraceDays,
  )

  const classification = classifyRentCollection({
    balanceDue: amountDue,
    rentDueDate: params.rentDueDate,
  })
  const classificationMeta = buildRentClassificationMetadata(
    classification,
    "balance_and_due_date",
  )

  const reminderState: RentCollectionState = {
    step: "initiated",
    classified_intent: "payment_reminder",
    amount_due: amountDue,
    billing_period: params.billingPeriod,
    rent_due_date: params.rentDueDate,
    unit_label: params.resident.unit,
    ...classificationMeta,
  }

  const run = await createWorkflowRun(supabase, {
    templateId: "rent_collection",
    landlordId: params.landlordId,
    triggerType: "cron",
    currentStep: "initiated",
    entityType: "user",
    entityId: params.resident.id,
    residentId: params.resident.id,
    metadata: {
      amount_due: amountDue,
      billing_period: params.billingPeriod,
      rent_due_date: params.rentDueDate,
      due_at: dueAt,
      unit_label: params.resident.unit,
      building: params.resident.building,
      classified_intent: "payment_reminder",
      ...classificationMeta,
      step_state: reminderState,
      cron_source: "check-rent-collection",
    },
    logTriggerEvent: true,
  })

  if (!run) {
    throw new Error("Failed to create workflow_run for rent_collection")
  }

  const graphScope = rentCollectionGraphScopeFromResident({
    landlordId: params.landlordId,
    workflowRunId: run.id,
    resident: params.resident,
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: run.id,
    eventType: RENT_GRAPH_EVENTS.dueDetected,
    step: "initiated",
    stage: "classify",
    message: "Rent due today or overdue",
    landlordId: params.landlordId,
    workflowType: "rent_collection",
    metadata: {
      rent_classification: classification,
      amount_due: amountDue,
      billing_period: params.billingPeriod,
      rent_due_date: params.rentDueDate,
      unit: params.resident.unit,
      building: params.resident.building,
      source: "check-rent-collection",
    },
  })

  await logRentCollectionGraphEvent(supabase, graphScope, {
    eventType: RENT_GRAPH_EVENTS.dueDetected,
    metadata: {
      rent_classification: classification,
      amount_due: amountDue,
      billing_period: params.billingPeriod,
      rent_due_date: params.rentDueDate,
      unit: params.resident.unit,
      building: params.resident.building,
      source: "check-rent-collection",
    },
  })

  await logRentCollectionLedgerWithGraph(supabase, graphScope, {
    ledgerEventType: "rent_due",
    direction: "debit",
    amount: amountDue,
    billingPeriod: params.billingPeriod,
    description: `Rent due for ${params.billingPeriod}`,
    metadata: {
      rent_due_date: params.rentDueDate,
      source: "check-rent-collection",
    },
  })

  const routed = await executeRentCollectionRouteAndAct(supabase, {
    landlordId: params.landlordId,
    resident: params.resident,
    runId: run.id,
    state: reminderState,
  })

  await updateWorkflowRun(supabase, run.id, {
    currentStep: "routed",
    currentStage: "routed",
    pipelineStage: "act",
    eventMessage: routed.paymentLink
      ? "Payment reminder sent with payment link"
      : routed.paymentRequested
      ? "Payment requested (no payment provider)"
      : routed.smsSent || routed.emailSent
      ? "Payment reminder sent"
      : "Routed (no SMS/email channel available)",
    eventStep: "routed",
    metadata: {
      ...classificationMeta,
      route_channels: routed.channels,
      payment_link: routed.paymentLink,
      payment_requested: routed.paymentRequested,
      payment_provider: routed.provider,
      step_state: {
        ...reminderState,
        step: "routed",
        outreach_sent_at: new Date().toISOString(),
        sms_sent: routed.smsSent,
        email_sent: routed.emailSent,
        route_channels: routed.channels,
        payment_link: routed.paymentLink,
        payment_requested: routed.paymentRequested,
        payment_provider: routed.provider,
      },
    },
  })

  return {
    resident_id: params.resident.id,
    billing_period: params.billingPeriod,
    amount_due: amountDue,
    workflow_run_id: run.id,
    workflow_type: "rent_collection",
    rent_classification: classification,
    stage: "routed",
    sms_sent: routed.smsSent,
    email_sent: routed.emailSent,
    route_channels: routed.channels,
    payment_link: routed.paymentLink,
    payment_requested: routed.paymentRequested,
  }
}

/**
 * check-rent-collection core:
 * 1. Find active residents with rent due today or overdue
 * 2. Start workflow_run (workflow_type = rent_collection)
 * 3. Log rent.due_detected
 * 4. Send SMS/email reminder
 * 5. Update stage to routed
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

  if (!rentDueWindow) {
    return {
      landlord_id: params.landlordId,
      billing_period: billingPeriod,
      rent_due_date: rentDueDate,
      rent_due_day: timing.rentDueDay,
      late_payment_grace_days: timing.latePaymentGraceDays,
      rent_due_window: false,
      candidates: 0,
      started: 0,
      skipped: 0,
      reminders_sent: 0,
      late_payment_escalated: 0,
      started_runs: [],
      errors: [],
    }
  }

  const residents = await findRentDueResidents(supabase)

  let started = 0
  let skipped = 0
  let remindersSent = 0
  const startedRuns: RentCollectionStartResult[] = []
  const errors: CheckRentCollectionResult["errors"] = []

  for (const resident of residents) {
    const duplicate = await hasActiveRentCollectionForPeriod(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      billingPeriod,
    })

    if (duplicate) {
      skipped++
      continue
    }

    try {
      const result = await startRentCollectionWorkflow(supabase, {
        landlordId: params.landlordId,
        resident,
        billingPeriod,
        rentDueDate,
        latePaymentGraceDays: timing.latePaymentGraceDays,
      })
      startedRuns.push(result)
      started++
      if (result.sms_sent || result.email_sent) remindersSent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[check-rent-collection] start failed", {
        residentId: resident.id,
        billingPeriod,
        error: message,
      })
      errors.push({
        resident_id: resident.id,
        billing_period: billingPeriod,
        error: message,
      })
    }
  }

  const { escalateLatePaymentRuns } = await import("./rentCollectionEscalation.ts")
  const latePaymentEscalated = await escalateLatePaymentRuns(supabase, params.landlordId)

  return {
    landlord_id: params.landlordId,
    billing_period: billingPeriod,
    rent_due_date: rentDueDate,
    rent_due_day: timing.rentDueDay,
    late_payment_grace_days: timing.latePaymentGraceDays,
    rent_due_window: true,
    candidates: residents.length,
    started,
    skipped,
    reminders_sent: remindersSent,
    late_payment_escalated: latePaymentEscalated,
    started_runs: startedRuns,
    errors,
  }
}
