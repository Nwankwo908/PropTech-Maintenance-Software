/**
 * Limited Alpha / payments-off rent recording.
 * Ulo does not move money — the landlord confirms receipt by SMS.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { findActiveLandlordMainNumber } from "../sms/landlordSmsOnboarding.ts"
import { smsProviderNameForSend } from "../sms/providerFactory.ts"
import { resolveLandlordOpsPhones } from "../sms/tenantActivationAdminAlert.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  runAmountDue,
  runBillingPeriod,
  runStepState,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import {
  buildRentClassificationMetadata,
  classifyRentCollection,
} from "./rentCollectionClassify.ts"
import { rentCollectionGraphScopeFromRun } from "./rentCollectionGraph.ts"
import { maybeSendOfflineTenantGraceReminder } from "./offlineTenantRentReminder.ts"
import type { RentCollectionState } from "./templates/rentCollection.ts"
import type { WorkflowRunRow } from "./types.ts"

export const RENT_PAYMENT_METHODS = [
  "zelle",
  "venmo",
  "ach",
  "check",
  "cash",
  "other",
] as const

export type RentPaymentMethod = (typeof RENT_PAYMENT_METHODS)[number]

export type LandlordRentReceiptKind = "yes" | "partial"

export type LandlordRentReceiptAsk = {
  runId: string
  residentId: string
  unitLabel: string
  amountDue: number
  billingPeriod: string
  dueToday?: boolean
  kind?: LandlordRentReceiptKind
  receivedAmount?: number
  remainingDue?: number
}

export type LandlordRentReceiptIntake = {
  awaiting: LandlordRentReceiptAsk | null
  awaitingAmount: LandlordRentReceiptAsk | null
  awaitingMethod: LandlordRentReceiptAsk | null
  queue: LandlordRentReceiptAsk[]
  processedMessageIds: string[]
  lastReply: string | null
}

export type ParsedLandlordRentReceiptReply =
  | { kind: "yes"; method?: RentPaymentMethod }
  | { kind: "no" }
  | {
    kind: "partial"
    amountStatus: "ok" | "missing" | "ambiguous"
    amount?: number
    method?: RentPaymentMethod
  }
  | { kind: "method"; method: RentPaymentMethod }
  | { kind: "amount"; amount: number }
  | { kind: "amount_ambiguous" }

export type PartialAmountCheck =
  | { ok: true; remaining: number }
  | { ok: false; reason: "not_positive" | "exceeds_balance" }

const AWAITING_KEY = "awaiting_landlord_rent_receipt"
const AMOUNT_KEY = "awaiting_landlord_rent_amount"
const METHOD_KEY = "awaiting_landlord_rent_method"
const QUEUE_KEY = "landlord_rent_receipt_queue"
const PROCESSED_KEY = "landlord_rent_receipt_message_ids"
const LAST_REPLY_KEY = "landlord_rent_receipt_last_reply"

const KEYWORD_STRIP =
  /\b(yes|yeah|y|no|n|nope|not yet|unpaid|partial|part|zelle|venmo|ach|bank|wire|check|cheque|cash|other|via|received|got it)\b/gi

export function roundRentCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function formatRentReceiptAmount(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  const hasCents = Math.round(n * 100) % 100 !== 0
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

export function formatRentReceiptUnitLabel(unitLabel: string | null | undefined): string {
  const raw = (unitLabel ?? "").trim()
  if (!raw) return "This unit"
  if (/^unit\b/i.test(raw)) return raw
  return `Unit ${raw}`
}

export function buildLandlordRentReceiptAskSms(ask: LandlordRentReceiptAsk): string {
  const unit = formatRentReceiptUnitLabel(ask.unitLabel)
  const amount = formatRentReceiptAmount(ask.amountDue)
  const due = ask.dueToday === false ? "rent" : "rent due today"
  return `${unit} — ${amount} ${due}. Did you receive it?\n\nReply YES, NO, or PARTIAL.`
}

export function buildLandlordRentReceiptMethodSms(): string {
  return (
    `What was your payment method?\n` +
    `Reply Zelle, Venmo, ACH, Check, Cash, or Other.`
  )
}

export function buildLandlordRentPartialAmountSms(ask: LandlordRentReceiptAsk): string {
  return `How much did you receive for ${formatRentReceiptUnitLabel(ask.unitLabel)}?`
}

export function buildLandlordRentUnpaidSms(ask: LandlordRentReceiptAsk): string {
  const unit = formatRentReceiptUnitLabel(ask.unitLabel)
  return `Got it — I marked ${unit} as unpaid.`
}

export function buildLandlordRentPaidConfirmSms(
  ask: LandlordRentReceiptAsk,
  method: RentPaymentMethod,
  received: number,
): string {
  return `Got it. ${formatRentReceiptAmount(received)} received via ${paymentMethodLabel(method)} for ${formatRentReceiptUnitLabel(ask.unitLabel)}.`
}

export function buildLandlordRentPartialConfirmSms(
  ask: LandlordRentReceiptAsk,
  method: RentPaymentMethod,
  received: number,
  remaining: number,
): string {
  return (
    `Got it. ${formatRentReceiptAmount(received)} received via ${paymentMethodLabel(method)} for ${formatRentReceiptUnitLabel(ask.unitLabel)}. ` +
    `${formatRentReceiptAmount(remaining)} is still due.`
  )
}

export function parseRentPaymentMethod(body: string): RentPaymentMethod | null {
  const t = body.trim().toLowerCase().replace(/[.!]+$/g, "")
  if (!t) return null
  if (/\bzelle\b/.test(t)) return "zelle"
  if (/\bvenmo\b/.test(t)) return "venmo"
  if (/\bach\b/.test(t) || /\bbank\b/.test(t) || /\bwire\b/.test(t)) return "ach"
  if (/\bcheck\b/.test(t) || /\bcheque\b/.test(t)) return "check"
  if (/\bcash\b/.test(t)) return "cash"
  if (/\bother\b/.test(t)) return "other"
  return null
}

/** Pull standalone dollar amounts; ignore unit labels like 2B. */
export function extractMoneyAmounts(body: string): number[] {
  const stripped = body.replace(KEYWORD_STRIP, " ")
  const matches = stripped.matchAll(
    /\$?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\d+(?:\.\d{1,2})?|(?<![A-Za-z0-9.])\d+(?:\.\d{1,2})?(?![A-Za-z0-9])/g,
  )
  const values: number[] = []
  for (const match of matches) {
    const raw = match[0].replace(/[$,]/g, "")
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const idx = match.index ?? 0
    const after = stripped.slice(idx + match[0].length, idx + match[0].length + 1)
    if (/[A-Za-z]/.test(after)) continue
    values.push(roundRentCents(n))
  }
  return [...new Set(values)]
}

export function parseMoneyAmountFromSms(
  body: string,
): { status: "ok"; amount: number } | { status: "none" } | { status: "ambiguous" } {
  const amounts = extractMoneyAmounts(body)
  if (amounts.length === 0) return { status: "none" }
  if (amounts.length > 1) return { status: "ambiguous" }
  return { status: "ok", amount: amounts[0]! }
}

export function checkPartialAmount(
  received: number,
  outstanding: number,
): PartialAmountCheck {
  const got = roundRentCents(received)
  const due = roundRentCents(outstanding)
  if (!(got > 0)) return { ok: false, reason: "not_positive" }
  if (got > due + 0.001) return { ok: false, reason: "exceeds_balance" }
  return { ok: true, remaining: roundRentCents(Math.max(0, due - got)) }
}

export function parseLandlordRentReceiptReply(
  body: string,
): ParsedLandlordRentReceiptReply | null {
  const method = parseRentPaymentMethod(body)
  const money = parseMoneyAmountFromSms(body)
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")

  const isPartial =
    normalized === "PARTIAL" ||
    normalized === "PART" ||
    normalized.startsWith("PARTIAL ") ||
    normalized.startsWith("PART ")

  if (
    normalized === "YES" ||
    normalized === "Y" ||
    normalized === "YEAH" ||
    normalized === "RECEIVED" ||
    normalized === "GOT IT" ||
    normalized.startsWith("YES ")
  ) {
    return method ? { kind: "yes", method } : { kind: "yes" }
  }

  if (
    normalized === "NO" ||
    normalized === "N" ||
    normalized === "NOPE" ||
    normalized === "NOT YET" ||
    normalized === "UNPAID"
  ) {
    return { kind: "no" }
  }

  if (isPartial) {
    if (money.status === "ambiguous") {
      return { kind: "partial", amountStatus: "ambiguous", method: method ?? undefined }
    }
    if (money.status === "ok") {
      return {
        kind: "partial",
        amountStatus: "ok",
        amount: money.amount,
        method: method ?? undefined,
      }
    }
    return { kind: "partial", amountStatus: "missing", method: method ?? undefined }
  }

  if (method && money.status === "none") return { kind: "method", method }
  if (money.status === "ok" && !method) return { kind: "amount", amount: money.amount }
  if (money.status === "ambiguous") return { kind: "amount_ambiguous" }
  if (method) return { kind: "method", method }
  return null
}

export function paymentMethodLabel(method: RentPaymentMethod): string {
  switch (method) {
    case "zelle":
      return "Zelle"
    case "venmo":
      return "Venmo"
    case "ach":
      return "ACH"
    case "check":
      return "Check"
    case "cash":
      return "Cash"
    case "other":
      return "Other"
  }
}

function asAsk(raw: unknown): LandlordRentReceiptAsk | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const runId = typeof row.runId === "string"
    ? row.runId.trim()
    : typeof row.run_id === "string"
    ? row.run_id.trim()
    : ""
  const residentId = typeof row.residentId === "string"
    ? row.residentId.trim()
    : typeof row.resident_id === "string"
    ? row.resident_id.trim()
    : ""
  if (!runId || !residentId) return null
  const amount = Number(row.amountDue ?? row.amount_due ?? 0)
  const received = Number(row.receivedAmount ?? row.received_amount ?? NaN)
  const remaining = Number(row.remainingDue ?? row.remaining_due ?? NaN)
  const kind = row.kind === "partial" || row.kind === "yes" ? row.kind : undefined
  return {
    runId,
    residentId,
    unitLabel: String(row.unitLabel ?? row.unit_label ?? "").trim(),
    amountDue: Number.isFinite(amount) ? amount : 0,
    billingPeriod: String(row.billingPeriod ?? row.billing_period ?? "").trim(),
    dueToday: row.dueToday === false || row.due_today === false ? false : true,
    kind,
    receivedAmount: Number.isFinite(received) ? received : undefined,
    remainingDue: Number.isFinite(remaining) ? remaining : undefined,
  }
}

function serializeAsk(ask: LandlordRentReceiptAsk): Record<string, unknown> {
  return {
    run_id: ask.runId,
    resident_id: ask.residentId,
    unit_label: ask.unitLabel,
    amount_due: ask.amountDue,
    billing_period: ask.billingPeriod,
    due_today: ask.dueToday !== false,
    kind: ask.kind ?? null,
    received_amount: ask.receivedAmount ?? null,
    remaining_due: ask.remainingDue ?? null,
  }
}

function readIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
}

export function readLandlordRentReceiptIntake(
  intakeState: unknown,
): LandlordRentReceiptIntake {
  if (!intakeState || typeof intakeState !== "object") {
    return {
      awaiting: null,
      awaitingAmount: null,
      awaitingMethod: null,
      queue: [],
      processedMessageIds: [],
      lastReply: null,
    }
  }
  const row = intakeState as Record<string, unknown>
  const queueRaw = Array.isArray(row[QUEUE_KEY]) ? row[QUEUE_KEY] : []
  return {
    awaiting: asAsk(row[AWAITING_KEY]),
    awaitingAmount: asAsk(row[AMOUNT_KEY]),
    awaitingMethod: asAsk(row[METHOD_KEY]),
    queue: queueRaw.map(asAsk).filter((item): item is LandlordRentReceiptAsk => Boolean(item)),
    processedMessageIds: readIdList(row[PROCESSED_KEY]),
    lastReply: typeof row[LAST_REPLY_KEY] === "string" ? row[LAST_REPLY_KEY] : null,
  }
}

export function writeLandlordRentReceiptIntake(
  prior: Record<string, unknown>,
  next: LandlordRentReceiptIntake,
): Record<string, unknown> {
  const out = { ...prior }
  if (next.awaiting) out[AWAITING_KEY] = serializeAsk(next.awaiting)
  else delete out[AWAITING_KEY]
  if (next.awaitingAmount) out[AMOUNT_KEY] = serializeAsk(next.awaitingAmount)
  else delete out[AMOUNT_KEY]
  if (next.awaitingMethod) out[METHOD_KEY] = serializeAsk(next.awaitingMethod)
  else delete out[METHOD_KEY]
  if (next.queue.length) out[QUEUE_KEY] = next.queue.map(serializeAsk)
  else delete out[QUEUE_KEY]
  if (next.processedMessageIds.length) {
    out[PROCESSED_KEY] = next.processedMessageIds.slice(-30)
  } else delete out[PROCESSED_KEY]
  if (next.lastReply) out[LAST_REPLY_KEY] = next.lastReply
  else delete out[LAST_REPLY_KEY]
  return out
}

export function askAlreadyTracked(
  intake: LandlordRentReceiptIntake,
  runId: string,
): boolean {
  if (intake.awaiting?.runId === runId) return true
  if (intake.awaitingAmount?.runId === runId) return true
  if (intake.awaitingMethod?.runId === runId) return true
  return intake.queue.some((item) => item.runId === runId)
}

export function hasLandlordRentReceiptPending(intakeState: unknown): boolean {
  const intake = readLandlordRentReceiptIntake(intakeState)
  return Boolean(intake.awaiting || intake.awaitingAmount || intake.awaitingMethod)
}

function todayIso(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

function withProcessed(
  intake: LandlordRentReceiptIntake,
  messageId: string | null,
  lastReply: string,
): LandlordRentReceiptIntake {
  const ids = messageId
    ? [...intake.processedMessageIds.filter((id) => id !== messageId), messageId]
    : intake.processedMessageIds
  return { ...intake, processedMessageIds: ids.slice(-30), lastReply }
}

function emptyPending(
  intake: LandlordRentReceiptIntake,
  extras: Partial<LandlordRentReceiptIntake> = {},
): LandlordRentReceiptIntake {
  return {
    awaiting: null,
    awaitingAmount: null,
    awaitingMethod: null,
    queue: intake.queue,
    processedMessageIds: intake.processedMessageIds,
    lastReply: intake.lastReply,
    ...extras,
  }
}

async function persistIntake(
  supabase: SupabaseClient,
  conversationId: string,
  prior: Record<string, unknown>,
  next: LandlordRentReceiptIntake,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: writeLandlordRentReceiptIntake(prior, next),
      updated_at: new Date().toISOString(),
      status: "open",
    })
    .eq("id", conversationId)
}

async function loadConversationIntake(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  return data?.intake_state && typeof data.intake_state === "object"
    ? data.intake_state as Record<string, unknown>
    : {}
}

function askFromRun(
  run: WorkflowRunRow,
  resident: { id: string; unit: string | null },
  dueToday: boolean,
): LandlordRentReceiptAsk {
  const state = runStepState<RentCollectionState>(run)
  return {
    runId: run.id,
    residentId: String(resident.id),
    unitLabel: (resident.unit ?? state.unit_label ?? "").trim(),
    amountDue: runAmountDue(run) ?? state.amount_due ?? 0,
    billingPeriod: runBillingPeriod(run) ?? state.billing_period ?? "",
    dueToday,
  }
}

async function stampRunAskStatus(
  supabase: SupabaseClient,
  run: WorkflowRunRow,
  status: "asked" | "queued",
): Promise<void> {
  const state = runStepState<RentCollectionState>(run)
  const askedAt = status === "asked"
    ? new Date().toISOString()
    : typeof run.metadata?.landlord_receipt_asked_at === "string"
    ? run.metadata.landlord_receipt_asked_at
    : undefined
  await updateWorkflowRun(supabase, run.id, {
    metadata: {
      landlord_receipt_ask_status: status,
      ...(askedAt ? { landlord_receipt_asked_at: askedAt } : {}),
      step_state: {
        ...state,
        landlord_receipt_ask_status: status,
      },
    },
    pipelineStage: "route",
    eventMessage: status === "asked"
      ? "Asked the property team whether rent was received"
      : "Queued rent receipt confirmation",
    eventStep: "landlord_receipt_ask",
  })
}

/**
 * On due date (payments-off): text the landlord once per unit.
 * Extra units wait in a FIFO queue on the same thread.
 */
export async function offerLandlordRentReceiptAsk(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    resident: { id: string; unit: string | null }
    dueToday?: boolean
  },
): Promise<{ sent: boolean; queued: boolean }> {
  const existingStatus = String(
    params.run.metadata?.landlord_receipt_ask_status ?? "",
  )
  if (existingStatus === "asked" || existingStatus === "answered") {
    return { sent: false, queued: false }
  }

  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  const phone = phones[0]
  if (!phone) {
    console.warn("[rent-receipt] no landlord ops phone", params.landlordId)
    return { sent: false, queued: false }
  }

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id || !main.phone_number) {
    console.warn("[rent-receipt] no landlord_main SMS number", params.landlordId)
    return { sent: false, queued: false }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone,
    identityType: "landlord",
  })
  if (!identity) return { sent: false, queued: false }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: null,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.run.id,
    templateId: "rent_collection",
  })

  const prior = await loadConversationIntake(supabase, conversationId)
  const intake = readLandlordRentReceiptIntake(prior)
  const ask = askFromRun(params.run, params.resident, params.dueToday !== false)

  if (askAlreadyTracked(intake, ask.runId)) {
    return { sent: false, queued: existingStatus === "queued" }
  }

  if (intake.awaiting || intake.awaitingAmount || intake.awaitingMethod) {
    await persistIntake(supabase, conversationId, prior, {
      ...intake,
      queue: [...intake.queue, ask],
    })
    await stampRunAskStatus(supabase, params.run, "queued")
    return { sent: false, queued: true }
  }

  const body = buildLandlordRentReceiptAskSms(ask)
  const providerName = smsProviderNameForSend({
    landlordId: params.landlordId,
    lineProvider: main.provider,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: main.phone_number,
    toNumber: phone,
    body,
    provider: providerName,
    source: "workflow_rent_receipt_ask",
  })

  if (!sent.ok) {
    console.error("[rent-receipt] SMS failed", sent.error)
    return { sent: false, queued: false }
  }

  await persistIntake(supabase, conversationId, prior, {
    ...intake,
    awaiting: ask,
    awaitingAmount: null,
    awaitingMethod: null,
  })
  await stampRunAskStatus(supabase, params.run, "asked")

  const scope = rentCollectionGraphScopeFromRun(params.run, params.landlordId)
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.receipt_asked",
    source: "automation",
    actorType: "system",
    residentId: ask.residentId,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    workflowRunId: params.run.id,
    workflowTemplateId: "rent_collection",
    conversationId,
    metadata: {
      message: `Asked if ${formatRentReceiptUnitLabel(ask.unitLabel)} rent of ${formatRentReceiptAmount(ask.amountDue)} was received.`,
      amount_due: ask.amountDue,
      billing_period: ask.billingPeriod,
      unit_label: ask.unitLabel,
    },
  })

  return { sent: true, queued: false }
}

async function sendNextAskIfQueued(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    prior: Record<string, unknown>
    intake: LandlordRentReceiptIntake
    messageId: string | null
    lastReply: string
  },
): Promise<string> {
  const next = params.intake.queue[0] ?? null
  const rest = params.intake.queue.slice(1)
  if (!next) {
    const stored = withProcessed(
      emptyPending(params.intake, { queue: [] }),
      params.messageId,
      params.lastReply,
    )
    await persistIntake(supabase, params.conversationId, params.prior, stored)
    return params.lastReply
  }

  const followUp = { ...next, dueToday: false }
  const nextSms = buildLandlordRentReceiptAskSms(followUp)
  const combined = `${params.lastReply}\n\n${nextSms}`
  const stored = withProcessed(
    emptyPending(params.intake, { awaiting: followUp, queue: rest }),
    params.messageId,
    combined,
  )
  await persistIntake(supabase, params.conversationId, params.prior, stored)

  const run = await getWorkflowRunById(supabase, next.runId)
  if (run) await stampRunAskStatus(supabase, run, "asked")
  return combined
}

async function loadOutstandingBalance(
  supabase: SupabaseClient,
  params: { landlordId: string; residentId: string; fallback: number },
): Promise<number> {
  const { data } = await supabase
    .from("users")
    .select("balance_due")
    .eq("id", params.residentId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  const n = Number(data?.balance_due)
  return Number.isFinite(n) ? roundRentCents(n) : roundRentCents(params.fallback)
}

function inboundIdsFromRun(run: WorkflowRunRow): string[] {
  const raw = run.metadata?.landlord_receipt_inbound_ids
  return readIdList(raw)
}

async function recordFullPayment(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: LandlordRentReceiptAsk
    conversationId: string
    messageId: string | null
    method?: RentPaymentMethod | null
    complete: boolean
  },
): Promise<{ duplicate: boolean; received: number }> {
  const run = await getWorkflowRunById(supabase, params.ask.runId)
  if (!run) return { duplicate: false, received: params.ask.amountDue }

  const ids = inboundIdsFromRun(run)
  if (params.messageId && ids.includes(params.messageId)) {
    return {
      duplicate: true,
      received: Number(run.metadata?.paid_amount ?? params.ask.amountDue) || params.ask.amountDue,
    }
  }

  const alreadyPaid = String(run.metadata?.rent_status ?? "").toLowerCase() === "paid"
  const now = new Date().toISOString()
  const paidDate = todayIso()
  const received = roundRentCents(params.ask.amountDue)
  const state = runStepState<RentCollectionState>(run)
  const classificationMeta = buildRentClassificationMetadata(
    classifyRentCollection({
      balanceDue: 0,
      rentDueDate: typeof run.metadata?.rent_due_date === "string"
        ? run.metadata.rent_due_date
        : state.rent_due_date ?? paidDate,
      paymentIntent: "paid",
    }),
    "payment_intent",
  )
  const nextIds = params.messageId ? [...ids, params.messageId].slice(-30) : ids

  await updateWorkflowRun(supabase, run.id, {
    status: params.complete ? "completed" : "active",
    currentStep: params.complete ? "completed" : "awaiting_payment",
    completedAt: params.complete ? now : null,
    metadata: {
      admin_payment_received_at: alreadyPaid
        ? run.metadata?.admin_payment_received_at ?? now
        : now,
      paid_amount: received,
      paid_date: paidDate,
      amount_due: 0,
      original_amount_due: run.metadata?.original_amount_due ?? received,
      rent_status: "paid",
      payment_intent: "paid",
      payment_source: "landlord_sms",
      payment_method: params.method ?? run.metadata?.payment_method ?? null,
      landlord_receipt_ask_status: params.complete ? "answered" : "asked",
      tenant_grace_reminders_enabled: false,
      tenant_grace_reminders_stopped: true,
      landlord_receipt_inbound_ids: nextIds,
      ...classificationMeta,
      step_state: {
        ...state,
        step: params.complete ? "completed" : "awaiting_payment",
        payment_intent: "paid",
        amount_due: 0,
        ...classificationMeta,
      },
    },
    pipelineStage: "act",
    eventMessage: "Landlord confirmed rent was received",
    eventStep: params.complete ? "completed" : "awaiting_payment",
  })

  if (!alreadyPaid) {
    await supabase
      .from("users")
      .update({ balance_due: 0 })
      .eq("id", params.ask.residentId)
      .eq("landlord_id", params.landlordId)
  }

  if (alreadyPaid && !params.method) return { duplicate: true, received }

  const scope = rentCollectionGraphScopeFromRun(run, params.landlordId)
  const methodNote = params.method
    ? ` via ${paymentMethodLabel(params.method)}`
    : ""
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: params.method ? "rent.receipt_method_recorded" : "rent.receipt_confirmed",
    source: "sms",
    actorType: "landlord",
    residentId: params.ask.residentId,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    workflowRunId: run.id,
    workflowTemplateId: "rent_collection",
    conversationId: params.conversationId,
    metadata: {
      message: `${formatRentReceiptUnitLabel(params.ask.unitLabel)} rent of ${formatRentReceiptAmount(received)} recorded as paid${methodNote}.`,
      amount: received,
      paid_date: paidDate,
      rent_status: "paid",
      payment_method: params.method ?? null,
      billing_period: params.ask.billingPeriod,
    },
  })

  return { duplicate: false, received }
}

async function recordPartialPayment(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: LandlordRentReceiptAsk
    conversationId: string
    messageId: string | null
    received: number
    remaining: number
    method?: RentPaymentMethod | null
  },
): Promise<{ duplicate: boolean }> {
  const run = await getWorkflowRunById(supabase, params.ask.runId)
  if (!run) return { duplicate: false }

  const ids = inboundIdsFromRun(run)
  if (params.messageId && ids.includes(params.messageId)) {
    return { duplicate: true }
  }

  const alreadyPartial = String(run.metadata?.rent_status ?? "").toLowerCase() === "partial" &&
    Number(run.metadata?.paid_amount) === roundRentCents(params.received)
  if (alreadyPartial && !params.method) return { duplicate: true }

  const now = new Date().toISOString()
  const paidDate = todayIso()
  const state = runStepState<RentCollectionState>(run)
  const original = Number(run.metadata?.original_amount_due ?? state.amount_due ?? params.ask.amountDue)
  const classificationMeta = buildRentClassificationMetadata(
    classifyRentCollection({
      balanceDue: params.remaining,
      rentDueDate: typeof run.metadata?.rent_due_date === "string"
        ? run.metadata.rent_due_date
        : state.rent_due_date ?? paidDate,
      paymentIntent: "partial",
      originalAmountDue: original,
    }),
    "payment_intent",
  )
  const nextIds = params.messageId ? [...ids, params.messageId].slice(-30) : ids

  await updateWorkflowRun(supabase, run.id, {
    status: "active",
    currentStep: "awaiting_payment",
    completedAt: null,
    metadata: {
      admin_payment_received_at: now,
      paid_amount: roundRentCents(params.received),
      paid_date: paidDate,
      amount_due: params.remaining,
      original_amount_due: original,
      rent_status: "partial",
      payment_intent: "partial",
      payment_source: "landlord_sms",
      payment_method: params.method ?? run.metadata?.payment_method ?? null,
      landlord_receipt_ask_status: "answered",
      tenant_grace_reminders_enabled: true,
      tenant_grace_reminders_stopped: false,
      landlord_receipt_inbound_ids: nextIds,
      ...classificationMeta,
      step_state: {
        ...state,
        step: "awaiting_payment",
        payment_intent: "partial",
        amount_due: params.remaining,
        ...classificationMeta,
      },
    },
    pipelineStage: "act",
    eventMessage: "Landlord recorded a partial rent payment",
    eventStep: "awaiting_payment",
  })

  if (!alreadyPartial) {
    await supabase
      .from("users")
      .update({ balance_due: params.remaining })
      .eq("id", params.ask.residentId)
      .eq("landlord_id", params.landlordId)
  }

  const scope = rentCollectionGraphScopeFromRun(run, params.landlordId)
  const methodNote = params.method
    ? ` via ${paymentMethodLabel(params.method)}`
    : ""
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: params.method ? "rent.receipt_method_recorded" : "rent.receipt_confirmed",
    source: "sms",
    actorType: "landlord",
    residentId: params.ask.residentId,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    workflowRunId: run.id,
    workflowTemplateId: "rent_collection",
    conversationId: params.conversationId,
    metadata: {
      message: `${formatRentReceiptUnitLabel(params.ask.unitLabel)} partial rent of ${formatRentReceiptAmount(params.received)} recorded${methodNote}. ${formatRentReceiptAmount(params.remaining)} still due.`,
      amount: params.received,
      remaining_due: params.remaining,
      paid_date: paidDate,
      rent_status: "partial",
      payment_method: params.method ?? null,
      billing_period: params.ask.billingPeriod,
    },
  })

  if (params.remaining > 0.001) {
    await startTenantGraceRemindersIfNeeded(supabase, {
      landlordId: params.landlordId,
      residentId: params.ask.residentId,
      runId: run.id,
    })
  }

  return { duplicate: false }
}

async function startTenantGraceRemindersIfNeeded(
  supabase: SupabaseClient,
  params: { landlordId: string; residentId: string; runId: string },
): Promise<void> {
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit")
    .eq("id", params.residentId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (!data?.id) return
  await maybeSendOfflineTenantGraceReminder(supabase, {
    landlordId: params.landlordId,
    runId: params.runId,
    resident: {
      id: String(data.id),
      full_name: data.full_name == null ? null : String(data.full_name),
      email: data.email == null ? null : String(data.email),
      phone: data.phone == null ? null : String(data.phone),
      unit: data.unit == null ? null : String(data.unit),
    },
  })
}

async function recordUnpaid(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: LandlordRentReceiptAsk
    conversationId: string
    messageId: string | null
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.ask.runId)
  if (!run) return
  const status = String(run.metadata?.rent_status ?? "").toLowerCase()
  if (status === "paid") return

  const ids = inboundIdsFromRun(run)
  if (params.messageId && ids.includes(params.messageId)) return

  const now = new Date().toISOString()
  const state = runStepState<RentCollectionState>(run)
  const outstanding = await loadOutstandingBalance(supabase, {
    landlordId: params.landlordId,
    residentId: params.ask.residentId,
    fallback: params.ask.amountDue,
  })
  const classificationMeta = buildRentClassificationMetadata(
    classifyRentCollection({
      balanceDue: outstanding,
      rentDueDate: typeof run.metadata?.rent_due_date === "string"
        ? run.metadata.rent_due_date
        : state.rent_due_date ?? todayIso(),
    }),
    "balance_and_due_date",
  )
  const nextIds = params.messageId ? [...ids, params.messageId].slice(-30) : ids

  await updateWorkflowRun(supabase, run.id, {
    status: "active",
    currentStep: "awaiting_payment",
    metadata: {
      rent_status: "unpaid",
      admin_payment_unpaid_at: now,
      landlord_receipt_ask_status: "answered",
      tenant_grace_reminders_enabled: true,
      tenant_grace_reminders_stopped: false,
      amount_due: outstanding,
      landlord_receipt_inbound_ids: nextIds,
      ...classificationMeta,
      step_state: {
        ...state,
        step: "awaiting_payment",
        amount_due: outstanding,
        ...classificationMeta,
      },
    },
    pipelineStage: "act",
    eventMessage: "Landlord marked rent unpaid",
    eventStep: "awaiting_payment",
  })

  const scope = rentCollectionGraphScopeFromRun(run, params.landlordId)
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.marked_unpaid",
    source: "sms",
    actorType: "landlord",
    residentId: params.ask.residentId,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    workflowRunId: run.id,
    workflowTemplateId: "rent_collection",
    conversationId: params.conversationId,
    metadata: {
      message: `${formatRentReceiptUnitLabel(params.ask.unitLabel)} rent of ${formatRentReceiptAmount(outstanding)} marked unpaid.`,
      amount: outstanding,
      rent_status: "unpaid",
      billing_period: params.ask.billingPeriod,
    },
  })

  await startTenantGraceRemindersIfNeeded(supabase, {
    landlordId: params.landlordId,
    residentId: params.ask.residentId,
    runId: run.id,
  })
}

function amountClarifySms(ask: LandlordRentReceiptAsk, reason: "not_positive" | "exceeds_balance" | "ambiguous" | "missing"): string {
  const unit = formatRentReceiptUnitLabel(ask.unitLabel)
  const due = formatRentReceiptAmount(ask.amountDue)
  if (reason === "exceeds_balance") {
    return `That amount is more than the ${due} due for ${unit}. How much did you receive?`
  }
  if (reason === "not_positive") {
    return `The amount needs to be more than $0. How much did you receive for ${unit}?`
  }
  return `I need the amount you received for ${unit}, like 1200. It must be more than $0 and not more than ${due}.`
}

export async function handleLandlordRentReceiptReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    messageId?: string | null
  },
): Promise<{ handled: true; replyBody: string } | { handled: false }> {
  if (
    params.identityType === "resident" ||
    params.identityType === "vendor"
  ) {
    return { handled: false }
  }

  const prior = await loadConversationIntake(supabase, params.conversationId)
  const intake = readLandlordRentReceiptIntake(prior)
  if (!intake.awaiting && !intake.awaitingAmount && !intake.awaitingMethod) {
    return { handled: false }
  }

  const messageId = params.messageId?.trim() || null
  if (messageId && intake.processedMessageIds.includes(messageId)) {
    return {
      handled: true,
      replyBody: intake.lastReply || "I already recorded that reply.",
    }
  }

  const parsed = parseLandlordRentReceiptReply(params.body)
  const methodPrompt = buildLandlordRentReceiptMethodSms()

  const replyAndStore = async (
    nextIntake: LandlordRentReceiptIntake,
    replyBody: string,
  ): Promise<{ handled: true; replyBody: string }> => {
    const stored = withProcessed(nextIntake, messageId, replyBody)
    await persistIntake(supabase, params.conversationId, prior, stored)
    return { handled: true, replyBody }
  }

  if (intake.awaitingMethod) {
    const method = parsed?.kind === "method"
      ? parsed.method
      : parsed?.kind === "yes" && parsed.method
      ? parsed.method
      : parsed?.kind === "partial" && parsed.method
      ? parsed.method
      : null
    if (!method) {
      return replyAndStore(intake, methodPrompt)
    }

    const ask = intake.awaitingMethod
    if (ask.kind === "partial") {
      const received = ask.receivedAmount ?? 0
      const remaining = ask.remainingDue ?? Math.max(0, ask.amountDue - received)
      await recordPartialPayment(supabase, {
        landlordId: params.landlordId,
        ask,
        conversationId: params.conversationId,
        messageId,
        received,
        remaining,
        method,
      })
      const confirm = buildLandlordRentPartialConfirmSms(ask, method, received, remaining)
      const body = await sendNextAskIfQueued(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior,
        intake,
        messageId,
        lastReply: confirm,
      })
      return { handled: true, replyBody: body }
    }

    const received = ask.receivedAmount ?? ask.amountDue
    await recordFullPayment(supabase, {
      landlordId: params.landlordId,
      ask,
      conversationId: params.conversationId,
      messageId,
      method,
      complete: true,
    })
    const confirm = buildLandlordRentPaidConfirmSms(ask, method, received)
    const body = await sendNextAskIfQueued(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior,
      intake,
      messageId,
      lastReply: confirm,
    })
    return { handled: true, replyBody: body }
  }

  if (intake.awaitingAmount) {
    const ask = intake.awaitingAmount
    if (parsed?.kind === "no") {
      await recordUnpaid(supabase, {
        landlordId: params.landlordId,
        ask,
        conversationId: params.conversationId,
        messageId,
      })
      const ack = buildLandlordRentUnpaidSms(ask)
      const body = await sendNextAskIfQueued(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior,
        intake,
        messageId,
        lastReply: ack,
      })
      return { handled: true, replyBody: body }
    }

    let amount: number | null = null
    if (parsed?.kind === "amount") amount = parsed.amount
    else if (parsed?.kind === "partial" && parsed.amountStatus === "ok" && parsed.amount != null) {
      amount = parsed.amount
    } else if (
      parsed?.kind === "amount_ambiguous" ||
      (parsed?.kind === "partial" && parsed.amountStatus === "ambiguous")
    ) {
      return replyAndStore(
        { ...intake, awaiting: null, awaitingAmount: ask, awaitingMethod: null },
        amountClarifySms(ask, "ambiguous"),
      )
    }

    if (amount == null) {
      return replyAndStore(
        { ...intake, awaiting: null, awaitingAmount: ask, awaitingMethod: null },
        amountClarifySms(ask, "missing"),
      )
    }

    const outstanding = await loadOutstandingBalance(supabase, {
      landlordId: params.landlordId,
      residentId: ask.residentId,
      fallback: ask.amountDue,
    })
    const checked = checkPartialAmount(amount, outstanding)
    if (!checked.ok) {
      return replyAndStore(
        { ...intake, awaiting: null, awaitingAmount: { ...ask, amountDue: outstanding }, awaitingMethod: null },
        amountClarifySms({ ...ask, amountDue: outstanding }, checked.reason),
      )
    }

    const method = parsed?.kind === "partial" ? parsed.method : undefined
    return finishPartial(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior,
      intake,
      ask: { ...ask, amountDue: outstanding },
      received: amount,
      remaining: checked.remaining,
      method: method ?? null,
      messageId,
    })
  }

  const ask = intake.awaiting
  if (!ask) return { handled: false }

  if (!parsed) {
    return replyAndStore(
      intake,
      "Reply YES if you received the full amount, NO if you did not, or PARTIAL if you received some of it.",
    )
  }

  if (parsed.kind === "no") {
    await recordUnpaid(supabase, {
      landlordId: params.landlordId,
      ask,
      conversationId: params.conversationId,
      messageId,
    })
    const ack = buildLandlordRentUnpaidSms(ask)
    const body = await sendNextAskIfQueued(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior,
      intake,
      messageId,
      lastReply: ack,
    })
    return { handled: true, replyBody: body }
  }

  if (parsed.kind === "partial") {
    if (parsed.amountStatus === "ambiguous") {
      return replyAndStore(
        emptyPending(intake, { awaitingAmount: ask }),
        amountClarifySms(ask, "ambiguous"),
      )
    }
    if (parsed.amountStatus === "missing" || parsed.amount == null) {
      return replyAndStore(
        emptyPending(intake, { awaitingAmount: ask }),
        buildLandlordRentPartialAmountSms(ask),
      )
    }

    const outstanding = await loadOutstandingBalance(supabase, {
      landlordId: params.landlordId,
      residentId: ask.residentId,
      fallback: ask.amountDue,
    })
    const checked = checkPartialAmount(parsed.amount, outstanding)
    if (!checked.ok) {
      return replyAndStore(
        emptyPending(intake, { awaitingAmount: { ...ask, amountDue: outstanding } }),
        amountClarifySms({ ...ask, amountDue: outstanding }, checked.reason),
      )
    }

    return finishPartial(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior,
      intake,
      ask: { ...ask, amountDue: outstanding },
      received: parsed.amount,
      remaining: checked.remaining,
      method: parsed.method ?? null,
      messageId,
    })
  }

  if (parsed.kind === "yes") {
    const outstanding = await loadOutstandingBalance(supabase, {
      landlordId: params.landlordId,
      residentId: ask.residentId,
      fallback: ask.amountDue,
    })
    const paidAsk = { ...ask, amountDue: outstanding, kind: "yes" as const, receivedAmount: outstanding, remainingDue: 0 }
    await recordFullPayment(supabase, {
      landlordId: params.landlordId,
      ask: paidAsk,
      conversationId: params.conversationId,
      messageId,
      method: parsed.method ?? null,
      complete: Boolean(parsed.method),
    })

    if (parsed.method) {
      const confirm = buildLandlordRentPaidConfirmSms(paidAsk, parsed.method, outstanding)
      const body = await sendNextAskIfQueued(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior,
        intake,
        messageId,
        lastReply: confirm,
      })
      return { handled: true, replyBody: body }
    }

    return replyAndStore(
      emptyPending(intake, { awaitingMethod: paidAsk }),
      methodPrompt,
    )
  }

  return replyAndStore(
    intake,
    "Reply YES if you received the full amount, NO if you did not, or PARTIAL if you received some of it.",
  )
}

async function finishPartial(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    prior: Record<string, unknown>
    intake: LandlordRentReceiptIntake
    ask: LandlordRentReceiptAsk
    received: number
    remaining: number
    method: RentPaymentMethod | null
    messageId: string | null
  },
): Promise<{ handled: true; replyBody: string }> {
  if (params.remaining <= 0.001) {
    const paidAsk = {
      ...params.ask,
      kind: "yes" as const,
      receivedAmount: params.received,
      remainingDue: 0,
    }
    await recordFullPayment(supabase, {
      landlordId: params.landlordId,
      ask: paidAsk,
      conversationId: params.conversationId,
      messageId: params.messageId,
      method: params.method,
      complete: Boolean(params.method),
    })
    if (params.method) {
      const confirm = buildLandlordRentPaidConfirmSms(paidAsk, params.method, params.received)
      const body = await sendNextAskIfQueued(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior: params.prior,
        intake: params.intake,
        messageId: params.messageId,
        lastReply: confirm,
      })
      return { handled: true, replyBody: body }
    }
    await persistIntake(
      supabase,
      params.conversationId,
      params.prior,
      withProcessed(
        emptyPending(params.intake, { awaitingMethod: paidAsk }),
        params.messageId,
        buildLandlordRentReceiptMethodSms(),
      ),
    )
    return { handled: true, replyBody: buildLandlordRentReceiptMethodSms() }
  }

  const partialAsk: LandlordRentReceiptAsk = {
    ...params.ask,
    kind: "partial",
    receivedAmount: params.received,
    remainingDue: params.remaining,
  }

  await recordPartialPayment(supabase, {
    landlordId: params.landlordId,
    ask: partialAsk,
    conversationId: params.conversationId,
    messageId: params.messageId,
    received: params.received,
    remaining: params.remaining,
    method: params.method,
  })

  if (params.method) {
    const confirm = buildLandlordRentPartialConfirmSms(
      partialAsk,
      params.method,
      params.received,
      params.remaining,
    )
    const body = await sendNextAskIfQueued(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior: params.prior,
      intake: params.intake,
      messageId: params.messageId,
      lastReply: confirm,
    })
    return { handled: true, replyBody: body }
  }

  await persistIntake(
    supabase,
    params.conversationId,
    params.prior,
    withProcessed(
      emptyPending(params.intake, { awaitingMethod: partialAsk }),
      params.messageId,
      buildLandlordRentReceiptMethodSms(),
    ),
  )
  return { handled: true, replyBody: buildLandlordRentReceiptMethodSms() }
}
