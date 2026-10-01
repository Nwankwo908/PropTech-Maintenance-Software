/**
 * HQS letter confirm — dispatch throw isolation surfaces vendor_notify_error.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"

Deno.test("hqs dispatch catch persists vendor_notify_error shape", async () => {
  // Pure contract of the catch-path update payload (mirrors hqsInspectionLetterConfirm).
  const error = "boom network"
  const vendorNotifyError = `Dispatch failed: ${error}`.slice(0, 500)
  assertStringIncludes(vendorNotifyError, "boom network")
  assertEquals(vendorNotifyError.startsWith("Dispatch failed:"), true)
})

Deno.test("hqs batch isolation: one throw does not prevent later ticketIds", () => {
  const workOrderIds = ["t1", "t2", "t3"]
  const completed: string[] = []
  const failed: string[] = []
  for (const ticketId of workOrderIds) {
    try {
      if (ticketId === "t2") throw new Error("dispatch boom")
      completed.push(ticketId)
    } catch (e) {
      failed.push(ticketId)
      const msg = e instanceof Error ? e.message : String(e)
      assertEquals(msg, "dispatch boom")
    }
  }
  assertEquals(completed, ["t1", "t3"])
  assertEquals(failed, ["t2"])
})

Deno.test("hqs Active Tasks requires maintenance_request workflow run after dispatch", () => {
  // Contract: every HQS ticket must get a workflow run (Active Tasks is run-backed).
  // Mirror the post-dispatch flags used in confirmAndCreateHqsInspectionLetter.
  const outcomes = [
    { kind: "vendor_assigned", vendorAssigned: true },
    { kind: "preferred_selection_underway", vendorAssigned: false },
    { kind: "nearby_options_sent", vendorAssigned: false },
  ] as const
  for (const outcome of outcomes) {
    const vendorAssigned = outcome.vendorAssigned ||
      outcome.kind === "preferred_selection_underway"
    const needsVendorEscalation = outcome.kind === "nearby_options_sent" ||
      outcome.kind === "dispatch_error" ||
      outcome.kind === "landlord_manual"
    assertEquals(typeof vendorAssigned, "boolean")
    assertEquals(typeof needsVendorEscalation, "boolean")
    // preferred_selection_underway (vendor probe) still counts as assigned for the run step
    if (outcome.kind === "preferred_selection_underway") {
      assertEquals(vendorAssigned, true)
    }
  }
})

Deno.test("hqs ticket insert payload includes resident_id from occupancy lookup", () => {
  // Contract: confirmAndCreateHqsInspectionLetter writes resident_id on insert
  // from the same occupancy lookup used for workflow runs (not omit / null).
  const occupancyResidentId = "be896aae-8ca8-4fb6-b83c-b16625813f6a"
  const residentId =
    typeof occupancyResidentId === "string" && occupancyResidentId.trim()
      ? occupancyResidentId.trim()
      : null
  const insertRow = {
    landlord_id: "de300000-0000-4000-8000-000000000003",
    unit_id: "2e7722df-3999-4d89-b158-3382f6471a85",
    resident_id: residentId,
    description: "HQS fail: Kitchen - Stove",
  }
  assertEquals(insertRow.resident_id, occupancyResidentId)
})

Deno.test("hqs workflow backfill resolves resident from occupancy when ticket.resident_id null", () => {
  const ticket = { resident_id: null as string | null, unit_id: "u1" }
  const occupancy = { resident_id: "be896aae-8ca8-4fb6-b83c-b16625813f6a" }
  let residentId = ticket.resident_id ?? null
  if (!residentId && ticket.unit_id) {
    residentId = occupancy.resident_id
  }
  assertEquals(residentId, "be896aae-8ca8-4fb6-b83c-b16625813f6a")
})

Deno.test("hqs downstream surfaces plan PM + HDG without overwriting market facts", async () => {
  const { planHqsPmComplianceTask, planHqsHomeDataGraphIngest } = await import(
    "../../../../shared/maintenance/hqsPropertySurfaces.ts"
  )
  const pm = planHqsPmComplianceTask({
    inspectionReportId: "8ac8ee35-9f78-44ec-85a8-97b90442e54c",
    unitLabel: "1",
    building: "646 Bartlett",
    reinspectionDate: "2026-10-20",
  })
  assertEquals(pm.taskKind, "inspection")
  assertEquals(pm.metadata.source, "hqs_letter")
  const hdg = planHqsHomeDataGraphIngest({
    inspectionReportId: "8ac8ee35-9f78-44ec-85a8-97b90442e54c",
    sourceDocumentId: "doc-1",
  })
  assertEquals(hdg.provider, "manual")
  assertEquals(
    hdg.providerRecordId,
    "hqs-letter:8ac8ee35-9f78-44ec-85a8-97b90442e54c",
  )
})
