/**
 * Extended domain tools — playbook-driven lookups promoted from legacy *Lookup paths.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AnalyticalQuery } from "../../routing/analyticalQuery.ts"
import { recurringRepairsLookup } from "../maintenance/recurringRepairsLookup.ts"
import { missingUpdatesLookup } from "../maintenance/missingUpdatesLookup.ts"
import { vendorVerificationStatusLookup } from "../vendors/vendorVerificationStatusLookup.ts"
import { portfolioBriefingLookup } from "../properties/portfolioBriefingLookup.ts"
import { periodSummaryLookup } from "../properties/periodSummaryLookup.ts"
import { oldestWaitingWorkOrderLookup } from "../maintenance/oldestWaitingWorkOrderLookup.ts"
import { entityInvestigationLookup } from "../maintenance/entityInvestigationLookup.ts"
import { deepOperationalInvestigationLookup } from "../maintenance/deepOperationalInvestigationLookup.ts"
import { unitMaintenanceRankingLookup } from "../maintenance/unitMaintenanceRankingLookup.ts"
import { propertySnapshotLookup } from "../properties/propertySnapshot.ts"
import {
  propertyPriceHistoryLookup,
  type PropertyPriceHistoryResult,
} from "../finance/propertyPriceHistory.ts"
import {
  rentHistoryLookup,
  type RentHistoryResult,
} from "../rent/rentHistoryLookup.ts"

export type ExtendedDomainToolId =
  | "get_recurring_repairs"
  | "get_missing_updates"
  | "get_vendor_verification"
  | "get_portfolio_briefing"
  | "summarize_period"
  | "get_oldest_waiting_work_order"
  | "investigate_entity"
  | "investigate_operations"
  | "rank_units_by_maintenance"
  | "get_property_snapshot"
  | "get_property_price_history"
  | "get_rent_history"

export async function getRecurringRepairs(
  supabase: SupabaseClient,
  params: { organizationId: string },
) {
  const base = await recurringRepairsLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_recurring_repairs" as const,
    params: { organizationId: params.organizationId },
  }
}

export async function getMissingUpdates(
  supabase: SupabaseClient,
  params: { organizationId: string },
) {
  const base = await missingUpdatesLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_missing_updates" as const,
    params: { organizationId: params.organizationId },
  }
}

export async function getVendorVerification(
  supabase: SupabaseClient,
  params: { organizationId: string },
) {
  const base = await vendorVerificationStatusLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_vendor_verification" as const,
    params: { organizationId: params.organizationId },
  }
}

export async function getPortfolioBriefing(
  supabase: SupabaseClient,
  params: { organizationId: string },
) {
  const base = await portfolioBriefingLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_portfolio_briefing" as const,
    params: { organizationId: params.organizationId },
  }
}

export async function summarizePeriod(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    question: string
    buildingFilter?: string | null
  },
) {
  const base = await periodSummaryLookup(supabase, {
    landlordId: params.organizationId,
    question: params.question,
    buildingFilter: params.buildingFilter ?? null,
  })
  return {
    ...base,
    toolId: "summarize_period" as const,
    params: {
      organizationId: params.organizationId,
      buildingFilter: params.buildingFilter ?? null,
    },
  }
}

export async function getOldestWaitingWorkOrder(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    buildingFilter?: string | null
  },
) {
  const base = await oldestWaitingWorkOrderLookup(supabase, {
    landlordId: params.organizationId,
    buildingFilter: params.buildingFilter ?? null,
  })
  return {
    ...base,
    toolId: "get_oldest_waiting_work_order" as const,
    params: {
      organizationId: params.organizationId,
      buildingFilter: params.buildingFilter ?? null,
    },
  }
}

export async function investigateEntity(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    question: string
    buildingFilter?: string | null
  },
) {
  const base = await entityInvestigationLookup(supabase, {
    landlordId: params.organizationId,
    question: params.question,
    buildingFilter: params.buildingFilter ?? null,
  })
  return {
    ...base,
    toolId: "investigate_entity" as const,
    params: {
      organizationId: params.organizationId,
      buildingFilter: params.buildingFilter ?? null,
    },
  }
}

export async function investigateOperations(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    question: string
    buildingFilter?: string | null
  },
) {
  const base = await deepOperationalInvestigationLookup(supabase, {
    landlordId: params.organizationId,
    question: params.question,
    buildingFilter: params.buildingFilter ?? null,
  })
  return {
    ...base,
    toolId: "investigate_operations" as const,
    params: {
      organizationId: params.organizationId,
      buildingFilter: params.buildingFilter ?? null,
    },
  }
}

export async function rankUnitsByMaintenance(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    buildingFilter?: string | null
    analytical?: AnalyticalQuery
  },
) {
  const base = await unitMaintenanceRankingLookup(supabase, {
    landlordId: params.organizationId,
    buildingFilter: params.buildingFilter ?? null,
    analytical: params.analytical,
  })
  return {
    ...base,
    toolId: "rank_units_by_maintenance" as const,
    params: {
      organizationId: params.organizationId,
      buildingFilter: params.buildingFilter ?? null,
    },
  }
}

export async function getPropertySnapshot(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    question: string
    jurisdiction: {
      stateCode: string | null
      cityLabel: string | null
      citySlug: string | null
    }
  },
) {
  const base = await propertySnapshotLookup(supabase, {
    landlordId: params.organizationId,
    question: params.question,
    jurisdiction: params.jurisdiction,
  })
  return {
    ...base,
    toolId: "get_property_snapshot" as const,
    params: {
      organizationId: params.organizationId,
      question: params.question,
    },
  }
}

export async function getPropertyPriceHistory(params: {
  buildingName: string | null
  addressLine?: string | null
  clarifyOnly?: boolean
}): Promise<PropertyPriceHistoryResult & {
  toolId: "get_property_price_history"
  params: Record<string, unknown>
}> {
  const base = await propertyPriceHistoryLookup({
    buildingName: params.buildingName,
    addressLine: params.addressLine ?? null,
    clarifyOnly: params.clarifyOnly,
  })
  return {
    ...base,
    toolId: "get_property_price_history",
    params: {
      buildingName: params.buildingName,
      addressLine: params.addressLine ?? null,
      clarifyOnly: Boolean(params.clarifyOnly),
    },
  }
}

export async function getRentHistory(params: {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
}): Promise<RentHistoryResult & {
  toolId: "get_rent_history"
  params: Record<string, unknown>
}> {
  const base = await rentHistoryLookup({
    buildingName: params.buildingName,
    cityLabel: params.cityLabel,
    stateCode: params.stateCode,
    addressLine: params.addressLine ?? null,
  })
  return {
    ...base,
    toolId: "get_rent_history",
    params: {
      buildingName: params.buildingName,
      cityLabel: params.cityLabel,
      stateCode: params.stateCode,
      addressLine: params.addressLine ?? null,
    },
  }
}

export type ExtendedDomainToolResult =
  | Awaited<ReturnType<typeof getRecurringRepairs>>
  | Awaited<ReturnType<typeof getMissingUpdates>>
  | Awaited<ReturnType<typeof getVendorVerification>>
  | Awaited<ReturnType<typeof getPortfolioBriefing>>
  | Awaited<ReturnType<typeof summarizePeriod>>
  | Awaited<ReturnType<typeof getOldestWaitingWorkOrder>>
  | Awaited<ReturnType<typeof investigateEntity>>
  | Awaited<ReturnType<typeof investigateOperations>>
  | Awaited<ReturnType<typeof rankUnitsByMaintenance>>
  | Awaited<ReturnType<typeof getPropertySnapshot>>
  | Awaited<ReturnType<typeof getPropertyPriceHistory>>
  | Awaited<ReturnType<typeof getRentHistory>>
