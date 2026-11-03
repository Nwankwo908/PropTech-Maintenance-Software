/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  landlordMessageAwaitsTenantReply,
  suppressAutomatedRentReply,
} from "./landlordAwait.ts"
import { outboundQuestionWithin24h } from "./shortReplyArbitration.ts"

const RENT_INVALID_REPLY_FALLBACK =
  "I didn't quite catch that — reply PAID if you've sent payment, PARTIAL for a partial payment, or QUESTIONS to talk with your property manager."

const PHOTO_ASK =
  "Hi Ganaia, this is the property management team. Please add a photo of the baseboard heater leak in the basement and reply here so we can complete the repair request. We'll text you as soon as a technician is scheduled."

const RENT_REMINDER =
  "Hi, this is a friendly reminder from your property management team. Your rent of $1,850.00 is due on October 1. Once you've paid, reply PAID. If you paid part of it, reply PARTIAL. Have a question? Reply QUESTIONS and we'll help."

Deno.test("a photo request waits for the resident without a question mark", () => {
  assertEquals(landlordMessageAwaitsTenantReply(PHOTO_ASK), true)
  assertEquals(landlordMessageAwaitsTenantReply("What's the unit number?"), true)
  assertEquals(
    landlordMessageAwaitsTenantReply(
      "We'll text you when a technician is scheduled.",
    ),
    false,
  )
  assertEquals(landlordMessageAwaitsTenantReply(RENT_REMINDER), false)
})

Deno.test("a recent photo request blocks a rent reply the way a question does", () => {
  const sentAt = new Date().toISOString()
  assertEquals(
    outboundQuestionWithin24h({ body: PHOTO_ASK, sentAt }),
    true,
  )
  assertEquals(
    outboundQuestionWithin24h({ body: RENT_REMINDER, sentAt }),
    false,
  )
})

Deno.test("disabled rent and a staff wait suppress the PAID fallback, not an emergency", () => {
  assertEquals(suppressAutomatedRentReply({
    workflowRoute: "rent_collection",
    source: "workflow_rent_collection",
    replyBody: RENT_INVALID_REPLY_FALLBACK,
    rentPaused: true,
    staffAwaiting: false,
    inboundIsEmergency: false,
  }), true)
  assertEquals(suppressAutomatedRentReply({
    workflowRoute: "rent_collection",
    source: "workflow_rent_collection",
    replyBody: RENT_INVALID_REPLY_FALLBACK,
    rentPaused: true,
    staffAwaiting: true,
    inboundIsEmergency: true,
  }), false)
  assertEquals(suppressAutomatedRentReply({
    workflowRoute: "resident_maintenance_intake",
    source: "workflow_resident_maintenance_intake",
    replyBody: "If it's safe, leave the building and call 911.",
    rentPaused: true,
    staffAwaiting: true,
    inboundIsEmergency: true,
  }), false)
})

Deno.test("returning a thread to Ulo does not replay a workflow, and duplicate SIDs are skipped", async () => {
  const release = await Deno.readTextFile(
    new URL("./adminConversationControl.ts", import.meta.url),
  )
  const inbound = await Deno.readTextFile(
    new URL("./inbound_processor.ts", import.meta.url),
  )
  assertEquals(release.includes("runWorkflowEngine"), false)
  assertEquals(inbound.includes('workflowRoute: "duplicate_sid"'), true)
})
