/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"

Deno.test("staff reply is handled before the workflow engine runs", async () => {
  const intake: Record<string, unknown> = {
    awaiting_staff_reply: {
      messageId: "msg-staff",
      sentAt: new Date().toISOString(),
      ticketId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  }
  let workflowCalls = 0
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
      chain.then = (resolve: (value: unknown) => unknown) => {
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
  // Same branch as inbound_processor: a handled registry result returns
  // through finishHandledInbound and never reaches routeInboundSmsWorkflow.
  if (!result.handled) workflowCalls += 1
  assertEquals(result.handled, true)
  if (result.handled) {
    assertEquals(result.workflowRoute, "staff_reply")
    assertEquals(result.reply, undefined)
  }
  assertEquals(workflowCalls, 0)

  const processor = await Deno.readTextFile(new URL("./inbound_processor.ts", import.meta.url))
  const handledAt = processor.indexOf("if (handlerResult.handled)")
  const workflowAt = processor.indexOf("routeInboundSmsWorkflow(")
  assertEquals(handledAt > 0 && workflowAt > handledAt, true)
})
