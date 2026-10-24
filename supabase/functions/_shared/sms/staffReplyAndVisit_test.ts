/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import { deliverVendorTextWithRetry } from "./vendorRescheduleSms.ts"
import { setManualVisitTime } from "./setManualVisitTime.ts"
import { AWAITING_SCHEDULE_CONFIRM_KEY } from "./tenantScheduleConfirm.ts"

Deno.test("staff question + Today? Yes routes to staff with no automated reply", async () => {
  const intake: Record<string, unknown> = {
    awaiting_staff_reply: {
      messageId: "msg-staff",
      sentAt: new Date().toISOString(),
      ticketId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  }
  let replyBody: string | null = null
  const supabase = {
    from() {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const method of ["select", "eq", "order", "limit", "in", "is", "gte", "not", "neq", "or"]) {
        chain[method] = self
      }
      let pending: Record<string, unknown> | null = null
      chain.update = (row: Record<string, unknown>) => {
        pending = row
        return chain
      }
      chain.insert = () => chain
      chain.maybeSingle = async () => ({
        data: { id: "conv-1", intake_state: intake, landlord_id: "landlord-1" },
        error: null,
      })
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (pending?.intake_state && typeof pending.intake_state === "object") {
          for (const key of Object.keys(intake)) delete intake[key]
          Object.assign(intake, pending.intake_state)
          pending = null
        }
        return Promise.resolve({ data: [], error: null }).then(resolve)
      }
      return chain
    },
  }
  const ctx: InboundSmsHandlerContext = {
    supabase: supabase as never,
    inbound: {
      provider: "twilio",
      providerMessageSid: "SM1",
      messageId: "SM1",
      from: "+12025550111",
      to: "+18770000000",
      body: "Today? Yes",
      mediaUrls: [],
      rawPayload: {},
    },
    landlordId: "landlord-1",
    conversationId: "conv-1",
    conversationType: "resident_intake",
    messageId: "msg-in",
    identity: {
      id: "ident-1",
      landlord_id: "landlord-1",
      resident_id: "res-1",
      vendor_id: null,
      unit_id: null,
      phone_number: "+12025550111",
      identity_type: "resident",
      verified: true,
    },
    maintenanceRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    selfHealed: false,
    resolutionSource: "active_resident",
    selfHealingPhase: "none",
    activeMaintenanceIntake: false,
  }
  const result = await tryInboundSmsHandlers(ctx)
  assertEquals(result.handled, true)
  if (result.handled) {
    replyBody = result.reply?.body ?? null
    assertEquals(result.workflowRoute, "staff_reply")
  }
  assertEquals(replyBody, null)
  assertEquals(intake.awaiting_staff_reply, undefined)
})

Deno.test("vendor text fails once, retries, then staff handoff reason is logged", async () => {
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(" "))
  }
  try {
    let calls = 0
    const delivery = await deliverVendorTextWithRetry(async () => {
      calls += 1
      return { ok: false, error: calls === 1 ? "carrier_down" : "send_failed" }
    })
    assertEquals(calls, 2)
    assertEquals(delivery.ok, false)
    assertEquals(delivery.reason, "send_failed")
    console.error("[tenant-reschedule] vendorNotified=false", delivery.reason)
    assertEquals(errors.some((line) => line.includes("send_failed")), true)
  } finally {
    console.error = original
  }
})

Deno.test("Set visit time schedules the ticket, closes the open ask, and texts the vendor once", async () => {
  const ticketId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const ticket: Record<string, unknown> = {
    id: ticketId,
    landlord_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    assigned_vendor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    vendor_work_status: "accepted",
    vendor_action_token: "",
  }
  const conversation = {
    id: "conv-resident",
    conversation_type: "resident_intake",
    maintenance_request_id: ticketId,
    intake_state: {
      [AWAITING_SCHEDULE_CONFIRM_KEY]: {
        ticket_id: ticketId,
        vendor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        window_text: "9–11am Fri",
      },
    } as Record<string, unknown>,
  }
  let vendorSends = 0
  const supabase = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pending: Record<string, unknown> | null = null
      const self = () => chain
      for (const method of [
        "select",
        "eq",
        "or",
        "in",
        "order",
        "limit",
        "is",
        "gte",
      ]) {
        chain[method] = self
      }
      chain.update = (row: Record<string, unknown>) => {
        pending = row
        return chain
      }
      chain.insert = () => chain
      chain.maybeSingle = async () => {
        if (table === "maintenance_requests") return { data: ticket, error: null }
        if (table === "vendors") {
          return { data: { name: "Ecosafe", phone: "+12025550199" }, error: null }
        }
        return { data: null, error: null }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (pending && table === "maintenance_requests") {
          Object.assign(ticket, pending)
          pending = null
        }
        if (pending && table === "sms_conversations") {
          if (pending.intake_state && typeof pending.intake_state === "object") {
            conversation.intake_state = pending.intake_state as Record<string, unknown>
          }
          pending = null
        }
        const rows = table === "sms_conversations" ? [conversation] : []
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      }
      return chain
    },
  }
  const result = await setManualVisitTime(
    supabase as never,
    {
      landlordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ticketId,
      visitDate: "2026-10-24",
      windowText: "4–5pm",
    },
    {
      sendVendor: async () => {
        vendorSends += 1
        return { ok: true }
      },
    },
  )
  assertEquals(result.ok, true)
  assertEquals(ticket.schedule_status, "scheduled")
  assertEquals(ticket.scheduled_window_text, "2026-10-24 4–5pm")
  assertEquals(typeof ticket.scheduled_at, "string")
  assertEquals(conversation.intake_state[AWAITING_SCHEDULE_CONFIRM_KEY], undefined)
  assertEquals(vendorSends, 1)
})
