/// <reference lib="deno.ns" />
/**
 * Both resident rent-send call sites must go through gateResidentAutomatedReminder.
 * payment_reminder → routeRentCollectionOutreach
 * late_payment → sendLatePaymentNotice
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts"

Deno.test("payment_reminder and late_payment call sites wire the quiet-hours gate", async () => {
  const reminder = await Deno.readTextFile(
    new URL("./templates/rentCollection.ts", import.meta.url),
  )
  const escalation = await Deno.readTextFile(
    new URL("./rentCollectionEscalation.ts", import.meta.url),
  )

  assert(
    reminder.includes("gateResidentAutomatedReminder"),
    "routeRentCollectionOutreach must import gateResidentAutomatedReminder",
  )
  assert(
    reminder.includes('messageType: "rent_reminder"'),
    "payment_reminder path must gate as rent_reminder",
  )
  assert(
    escalation.includes("gateResidentAutomatedReminder"),
    "sendLatePaymentNotice must import gateResidentAutomatedReminder",
  )
  assert(
    escalation.includes('messageType: "rent_reminder"'),
    "late_payment path must gate as rent_reminder",
  )
  assert(
    escalation.includes("isRentCollectionPaused"),
    "escalation must honor landlord-level pause (no late-rent landlord notify)",
  )
  assert(
    reminder.includes("isRentCollectionPaused"),
    "payment_reminder cron must honor landlord-level pause",
  )
  assert(
    reminder.includes("landlordReceiptAskStatus: null") ||
      reminder.includes("Rent collection paused"),
    "paused route/act must not offer landlord rent receipt asks",
  )
})
