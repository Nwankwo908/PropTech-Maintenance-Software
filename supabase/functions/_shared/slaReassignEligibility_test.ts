import { shouldSkipSlaReassignForNeedsAdminVendor } from "./slaReassignEligibility.ts"

const assignedPending = shouldSkipSlaReassignForNeedsAdminVendor({
  assignedVendorId: "812ce971-a54c-4666-9221-1a4d84e292fe",
  vendorWorkStatus: "pending_accept",
  workflowNeedsAdminVendor: true,
})
if (assignedPending) {
  throw new Error("WO-E6F7-style ticket must remain eligible for SLA rematch")
}

const unassignedEscalated = shouldSkipSlaReassignForNeedsAdminVendor({
  assignedVendorId: null,
  vendorWorkStatus: "unassigned",
  workflowNeedsAdminVendor: true,
})
if (!unassignedEscalated) {
  throw new Error("true no-vendor escalation should still skip duplicate rematch")
}

const pendingWithoutVendor = shouldSkipSlaReassignForNeedsAdminVendor({
  assignedVendorId: null,
  vendorWorkStatus: "pending_accept",
  workflowNeedsAdminVendor: true,
})
if (pendingWithoutVendor) {
  throw new Error("pending_accept must not be blocked by stale no_vendor_available")
}

console.log("slaReassignEligibility_test ok")
