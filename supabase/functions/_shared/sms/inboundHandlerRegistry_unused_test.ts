/// <reference lib="deno.ns" />
/**
 * Every inbound handler adapter must be registered OR listed unused with a reason.
 * Prevents the invoice_paid_confirmation failure mode (implemented, never claimed).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  INBOUND_SMS_HANDLERS,
  INBOUND_SMS_HANDLERS_UNUSED,
} from "./inboundHandlerRegistry.ts"

const REGISTRY_SOURCE_URL = new URL(
  "./inboundHandlerRegistry.ts",
  import.meta.url,
)

/** try*Handler adapters defined in inboundHandlerRegistry.ts */
const ADAPTER_ID_FROM_FN: Record<string, string> = {
  tryComplianceStopHelpHandler: "compliance_stop_help",
  tryScheduleConfirmHandler: "schedule_confirm",
  tryEstimateDecisionHandler: "estimate_decision",
  tryLandlordVendorChoiceHandler: "landlord_vendor_choice",
  tryLandlordRentReceiptHandler: "landlord_rent_receipt",
  tryInvoicePaidConfirmationHandler: "invoice_paid_confirmation",
  tryInvoicePaymentHandler: "invoice_payment",
  tryTenantActivationReplyHandler: "tenant_activation_reply",
  tryTenantActivationHoldHandler: "tenant_activation_hold",
  tryVendorAvailabilityProbeHandler: "vendor_availability_probe",
  tryVendorRescheduleHandler: "vendor_reschedule",
  tryVendorCapacityHandler: "vendor_capacity",
  tryVendorFeedbackHandler: "vendor_feedback",
  tryVendorTenantProxyHandler: "vendor_tenant_proxy",
}

Deno.test("every inbound handler adapter is registered or explicitly unused", async () => {
  const source = await Deno.readTextFile(REGISTRY_SOURCE_URL)
  const defined = [
    ...source.matchAll(
      /async function (try\w+Handler)\s*\(/g,
    ),
  ].map((m) => m[1]!)

  const registered = new Set(INBOUND_SMS_HANDLERS.map((h) => h.id))
  const unused = new Set(Object.keys(INBOUND_SMS_HANDLERS_UNUSED))

  const missing: string[] = []
  for (const fn of defined) {
    const id = ADAPTER_ID_FROM_FN[fn]
    if (!id) {
      missing.push(`${fn} (add to ADAPTER_ID_FROM_FN map in unused test)`)
      continue
    }
    if (!registered.has(id) && !unused.has(id)) {
      missing.push(
        `${fn} → ${id} (register in INBOUND_SMS_HANDLERS or list in INBOUND_SMS_HANDLERS_UNUSED with a reason)`,
      )
    }
  }

  assertEquals(
    missing,
    [],
    `Implemented but unregistered handlers:\n${missing.join("\n")}`,
  )

  for (const [id, reason] of Object.entries(INBOUND_SMS_HANDLERS_UNUSED)) {
    assertEquals(
      Boolean(reason?.trim()),
      true,
      `INBOUND_SMS_HANDLERS_UNUSED[${id}] needs a non-empty reason`,
    )
    assertEquals(
      registered.has(id),
      false,
      `${id} is both registered and listed unused`,
    )
  }
})

Deno.test("invoice_paid_confirmation is registered (live YES/NO ask)", () => {
  const handler = INBOUND_SMS_HANDLERS.find(
    (h) => h.id === "invoice_paid_confirmation",
  )
  assertEquals(Boolean(handler), true)
  assertEquals(handler!.priority < 25, true) // before invoice_payment (1–4)
  assertEquals(handler!.priority > 22, true) // after landlord_rent_receipt
})
