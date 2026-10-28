/**
 * Repeated landlord YES/APPROVE after the approval ask is already closed.
 * Sends an acknowledgement only. Does not assign, approve, or text a vendor.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { residentRequestRef } from "../../../../shared/maintenance/residentRequestRef.ts"
import { landlordPickReplyMayExecute } from "../../../../shared/landlordDecisions/batchAccess.ts"
import {
  parseRepeatedApprovalReply,
  repeatedApprovalAcknowledgement,
  resolveRepeatedApproval,
  vendorNotificationVerified,
  type RepeatedApprovalTarget,
} from "../../../../shared/sms/repeatedApprovalAck.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import { listSpecificYesNoPendingAsks } from "./shortReplyArbitration.ts"

const APPROVED_WORK = new Set(["pending_accept", "accepted", "in_progress"])

type TicketRow = {
  id?: string
  resident_request_ref?: string | null
  vendor_notified_at?: string | null
  vendor_notify_error?: string | null
  assigned_vendor_id?: string | null
  vendor_work_status?: string | null
  issue_headline?: string | null
}

export async function loadRepeatedApprovalAcknowledgement(
  supabase: SupabaseClient,
  ticketId: string | null | undefined,
): Promise<string> {
  const id = (ticketId ?? "").trim()
  if (!id) return repeatedApprovalAcknowledgement({ vendorNotified: false })
  const { data } = await supabase
    .from("maintenance_requests")
    .select("id, resident_request_ref, vendor_notified_at, vendor_notify_error")
    .eq("id", id)
    .maybeSingle()
  const row = (data ?? null) as TicketRow | null
  return repeatedApprovalAcknowledgement({
    ref: residentRequestRef(row?.id || id, row?.resident_request_ref),
    vendorNotified: vendorNotificationVerified({
      vendorNotifiedAt: row?.vendor_notified_at,
      vendorNotifyError: row?.vendor_notify_error,
    }),
  })
}

function intakeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function approvedTicket(row: TicketRow | undefined): boolean {
  if (!row?.id) return false
  const status = (row.vendor_work_status ?? "").trim()
  if (status === "cancelled" || status === "declined") return false
  const error = (row.vendor_notify_error ?? "").trim()
  if (/awaiting landlord/i.test(error)) return false
  const assigned = (row.assigned_vendor_id ?? "").trim()
  return Boolean(assigned) || APPROVED_WORK.has(status)
}

function toTarget(
  row: TicketRow,
  batchId: string,
  labelFallback: string,
): RepeatedApprovalTarget {
  const id = String(row.id)
  return {
    ticketId: id,
    ref: residentRequestRef(id, row.resident_request_ref),
    workOrderRef: formatWorkOrderRef(id),
    label: (row.issue_headline ?? "").trim() || labelFallback,
    vendorNotified: vendorNotificationVerified({
      vendorNotifiedAt: row.vendor_notified_at,
      vendorNotifyError: row.vendor_notify_error,
    }),
    batchId,
  }
}

export async function tryHandleRepeatedLandlordApproval(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    fromPhone?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; ticketId: string | null; replyBody: string }
> {
  if (params.identityType.trim().toLowerCase() === "vendor") {
    return { handled: false }
  }
  if (parseRepeatedApprovalReply(params.body).kind === "none") {
    return { handled: false }
  }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, external_phone_number")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  const phone = (params.fromPhone ?? "").trim() ||
    (typeof conv?.external_phone_number === "string" ? conv.external_phone_number : "")

  const intakes: unknown[] = [conv?.intake_state]
  if (phone) {
    const { data: others } = await supabase
      .from("sms_conversations")
      .select("id, intake_state, external_phone_number")
      .eq("landlord_id", params.landlordId)
      .eq("external_phone_number", phone)
      .limit(25)
    for (const row of others ?? []) intakes.push(row.intake_state)
  }

  let pendingQuestionCount = 0
  for (const intake of intakes) {
    pendingQuestionCount += listSpecificYesNoPendingAsks(intake).length
  }

  const phoneMatches = (recipient: string) =>
    landlordPickReplyMayExecute({
      identityType: params.identityType,
      fromPhone: phone,
      recipientPhone: recipient,
    })

  const { data: openBatches } = await supabase
    .from("landlord_pick_batches")
    .select("id, recipient_phone, status")
    .eq("landlord_id", params.landlordId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(8)
  const openForSender = (openBatches ?? []).filter((row) =>
    phoneMatches(String(row.recipient_phone ?? ""))
  )
  if (openForSender.length > 0) pendingQuestionCount += openForSender.length

  const { data: closedBatches } = await supabase
    .from("landlord_pick_batches")
    .select("id, created_at, recipient_phone, status")
    .eq("landlord_id", params.landlordId)
    .eq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(8)
  const closedForSender = (closedBatches ?? []).filter((row) =>
    phoneMatches(String(row.recipient_phone ?? ""))
  )

  const batchIds = closedForSender
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean)
  const { data: items } = batchIds.length
    ? await supabase
      .from("landlord_pick_batch_items")
      .select("batch_id, ticket_id, snapshot, position")
      .in("batch_id", batchIds)
    : { data: [] as Array<Record<string, unknown>> }

  const ticketIds = [
    ...new Set(
      (items ?? [])
        .map((row) => (typeof row.ticket_id === "string" ? row.ticket_id : ""))
        .filter(Boolean),
    ),
  ]
  const { data: tickets } = ticketIds.length
    ? await supabase
      .from("maintenance_requests")
      .select(
        "id, resident_request_ref, vendor_notified_at, vendor_notify_error, assigned_vendor_id, vendor_work_status, issue_headline",
      )
      .eq("landlord_id", params.landlordId)
      .in("id", ticketIds)
    : { data: [] as TicketRow[] }

  const ticketById = new Map(
    ((tickets ?? []) as TicketRow[])
      .filter((row) => typeof row.id === "string")
      .map((row) => [String(row.id), row]),
  )

  const latestBatchId = typeof closedForSender[0]?.id === "string"
    ? closedForSender[0].id
    : ""
  const targetsFor = (batchId: string): RepeatedApprovalTarget[] => {
    const rows = (items ?? [])
      .filter((row) => row.batch_id === batchId)
      .slice()
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    const out: RepeatedApprovalTarget[] = []
    for (const row of rows) {
      const ticketId = typeof row.ticket_id === "string" ? row.ticket_id : ""
      const ticket = ticketById.get(ticketId)
      if (!ticket || !approvedTicket(ticket)) continue
      const snap = intakeRecord(row.snapshot)
      const issue = typeof snap.issue === "string" ? snap.issue : ""
      out.push(toTarget(ticket, batchId, issue))
    }
    return out
  }

  const latestAsk = latestBatchId ? targetsFor(latestBatchId) : []
  const namedPool = closedForSender.flatMap((row) =>
    typeof row.id === "string" ? targetsFor(row.id) : []
  )
  const named = parseRepeatedApprovalReply(params.body)
  if (named.kind === "named") {
    const { data: byRef } = await supabase
      .from("maintenance_requests")
      .select(
        "id, resident_request_ref, vendor_notified_at, vendor_notify_error, assigned_vendor_id, vendor_work_status, issue_headline",
      )
      .eq("landlord_id", params.landlordId)
      .eq("resident_request_ref", named.ref)
      .limit(3)
    for (const row of (byRef ?? []) as TicketRow[]) {
      if (!approvedTicket(row)) continue
      namedPool.push(toTarget(row, "ref", (row.issue_headline ?? "").trim()))
    }
  }

  const decision = resolveRepeatedApproval({
    body: params.body,
    pendingQuestionCount,
    latestAsk,
    namedPool,
  })
  if (decision.action === "ignore") return { handled: false }
  return {
    handled: true,
    ticketId: decision.action === "acknowledge" ? decision.ticketId : null,
    replyBody: decision.body,
  }
}
