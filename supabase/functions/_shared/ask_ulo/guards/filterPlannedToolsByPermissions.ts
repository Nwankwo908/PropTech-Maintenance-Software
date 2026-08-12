/**
 * Drop planned domain tools the current user is not allowed to run.
 */
import type { AskUloPermissions } from "../core/types.ts"
import type { PlannedDomainToolCall } from "../routing/selectTools.ts"

const VENDOR_TOOLS = new Set([
  "rank_vendors",
  "get_vendor_verification",
])

export function filterPlannedToolsByPermissions(
  planned: PlannedDomainToolCall[],
  permissions: AskUloPermissions,
): PlannedDomainToolCall[] {
  return planned.filter((call) => {
    if (!permissions.canSeeResidents && call.name === "search_residents") {
      return false
    }
    if (!permissions.canSeeVendors && VENDOR_TOOLS.has(call.name)) {
      return false
    }
    if (!permissions.canSeeFinance && call.name === "get_landlord_incentives") {
      return false
    }
    return true
  })
}
