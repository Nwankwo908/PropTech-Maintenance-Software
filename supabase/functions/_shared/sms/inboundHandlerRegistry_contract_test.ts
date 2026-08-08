/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  INBOUND_SMS_HANDLER_PENDING_GATES,
  INBOUND_SMS_HANDLERS,
} from "./inboundHandlerRegistry.ts"

const processorUrl = new URL("./inbound_processor.ts", import.meta.url)
const vendorResponseUrl = new URL(
  "../engine/templates/vendorResponse.ts",
  import.meta.url,
)
const vendorRescheduleInboundUrl = new URL(
  "./vendorRescheduleInbound.ts",
  import.meta.url,
)
const vendorRescheduleWorkflowActUrl = new URL(
  "./vendorRescheduleWorkflowAct.ts",
  import.meta.url,
)

Deno.test("R2: every registry handler documents a pending gate", () => {
  const handlerIds = INBOUND_SMS_HANDLERS.map((h) => h.id)
  const documentedIds = Object.keys(INBOUND_SMS_HANDLER_PENDING_GATES)

  assertEquals(
    documentedIds.sort(),
    handlerIds.sort(),
    "Update INBOUND_SMS_HANDLER_PENDING_GATES when adding/removing handlers",
  )

  for (const id of handlerIds) {
    const gate = INBOUND_SMS_HANDLER_PENDING_GATES[id]?.trim()
    assertEquals(Boolean(gate), true, `Missing pending gate for ${id}`)
  }
})

Deno.test("R3: inbound_processor short-circuits before workflow when handler wins", async () => {
  const source = await Deno.readTextFile(processorUrl)

  const handlerCall = source.indexOf("tryInboundSmsHandlers(handlerContext)")
  assertEquals(handlerCall >= 0, true, "expected tryInboundSmsHandlers call")

  const finishCall = source.indexOf("finishHandledInbound(handlerContext, handlerResult)")
  assertEquals(finishCall >= 0, true, "expected finishHandledInbound call")

  const workflowCall = source.indexOf("routeInboundSmsWorkflow(supabase,")
  assertEquals(workflowCall >= 0, true, "expected routeInboundSmsWorkflow fallback")

  assertEquals(
    handlerCall < finishCall && finishCall < workflowCall,
    true,
    "Order must be: handlers → finishHandledInbound → routeInboundSmsWorkflow",
  )

  const betweenHandlerAndWorkflow = source.slice(handlerCall, workflowCall)
  assertEquals(
    betweenHandlerAndWorkflow.includes("if (handlerResult.handled)"),
    true,
    "Must guard workflow fallback on handlerResult.handled",
  )
  assertEquals(
    betweenHandlerAndWorkflow.includes("return finishHandledInbound"),
    true,
    "Handled path must return before workflow engine runs",
  )
})

Deno.test("R3: vendor reschedule business logic lives in workflow only", async () => {
  const inbound = await Deno.readTextFile(vendorRescheduleInboundUrl)
  const workflowAct = await Deno.readTextFile(vendorRescheduleWorkflowActUrl)
  const vendorResponse = await Deno.readTextFile(vendorResponseUrl)

  assertEquals(inbound.includes("tryHandleVendorRescheduleSms"), false)
  assertEquals(inbound.includes("routeVendorRescheduleToWorkflow"), true)
  assertEquals(inbound.includes("runWorkflowEngine"), true)

  assertEquals(workflowAct.includes("tryHandleVendorRescheduleSms"), true)
  assertEquals(workflowAct.includes("actVendorRescheduleInboundTurn"), true)

  assertEquals(vendorResponse.includes("tryActVendorRescheduleTurn"), true)
  assertEquals(vendorResponse.includes("tryHandleVendorRescheduleInbound"), false)
})

Deno.test("R4: workflow-owned domains are not registered as inbound handlers", () => {
  const ids = new Set(INBOUND_SMS_HANDLERS.map((h) => h.id))

  const workflowOnly = [
    "maintenance_intake",
    "rent_collection",
    "lease_renewal",
    "move_in",
    "move_out",
    "inspection",
    "vendor_job_response",
    "identity_onboarding",
  ]

  for (const templateId of workflowOnly) {
    assertEquals(
      ids.has(templateId),
      false,
      `${templateId} must stay in workflow engine, not INBOUND_SMS_HANDLERS`,
    )
  }
})
