/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  shouldActVendorRescheduleInWorkflow,
  shouldAttemptVendorRescheduleInbound,
} from "./vendorRescheduleWorkflowAct.ts"

Deno.test("shouldAttempt — reschedule keywords on locked schedule path", () => {
  assertEquals(
    shouldAttemptVendorRescheduleInbound({
      vendorId: "v1",
      body: "Need to reschedule to tomorrow at 2pm",
      pendingRescheduleVendorId: null,
      clarificationOriginalIntent: null,
      scheduleStep: undefined,
    }),
    true,
  )
})

Deno.test("shouldAttempt — blocks initial availability negotiation", () => {
  assertEquals(
    shouldAttemptVendorRescheduleInbound({
      vendorId: "v1",
      body: "Wednesday at 2pm works",
      pendingRescheduleVendorId: null,
      clarificationOriginalIntent: null,
      scheduleStep: "awaiting_availability",
    }),
    false,
  )
})

Deno.test("shouldAttempt — WO clarify resume counts as reschedule", () => {
  assertEquals(
    shouldAttemptVendorRescheduleInbound({
      vendorId: "v1",
      body: "2",
      pendingRescheduleVendorId: null,
      clarificationOriginalIntent: "reschedule",
      scheduleStep: "awaiting_availability",
    }),
    true,
  )
})

Deno.test("shouldAttempt — pending time follow-up without repeat keywords", () => {
  assertEquals(
    shouldAttemptVendorRescheduleInbound({
      vendorId: "v1",
      body: "Tomorrow at 3pm",
      pendingRescheduleVendorId: "v1",
      clarificationOriginalIntent: null,
      scheduleStep: undefined,
    }),
    true,
  )
})

Deno.test("shouldActVendorRescheduleInWorkflow — registry dispatch reason bypasses re-gate", () => {
  assertEquals(
    shouldActVendorRescheduleInWorkflow(
      {
        templateId: "vendor_job_response",
        confidence: "high",
        reason: "vendor_reschedule_registry_dispatch",
      },
      {
        vendorId: "v1",
        body: "Wednesday at 2pm works",
        pendingRescheduleVendorId: null,
        clarificationOriginalIntent: null,
        scheduleStep: "awaiting_availability",
      },
    ),
    true,
  )
})

Deno.test("registry inbound source dispatches via workflow engine only", async () => {
  const source = await Deno.readTextFile(
    new URL("./vendorRescheduleInbound.ts", import.meta.url),
  )
  assertEquals(source.includes("runWorkflowEngine"), true)
  assertEquals(source.includes("vendor_reschedule_registry_dispatch"), true)
  assertEquals(source.includes("tryHandleVendorRescheduleSms"), false)
})
