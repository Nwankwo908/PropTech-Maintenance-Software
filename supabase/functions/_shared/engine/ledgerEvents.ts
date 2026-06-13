import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type LedgerEventDirection = "debit" | "credit"

export type LedgerEventParams = {
  landlordId: string
  eventType: string
  direction?: LedgerEventDirection
  amount?: number | null
  currency?: string
  billingPeriod?: string | null
  description?: string | null
  workflowRunId?: string | null
  workflowType?: string | null
  residentId?: string | null
  unitId?: string | null
  propertyId?: string | null
  metadata?: Record<string, unknown>
}

export async function logLedgerEvent(
  supabase: SupabaseClient,
  params: LedgerEventParams,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ledger_events")
    .insert({
      landlord_id: params.landlordId,
      workflow_run_id: params.workflowRunId ?? null,
      workflow_type: params.workflowType ?? null,
      resident_id: params.residentId ?? null,
      unit_id: params.unitId ?? null,
      property_id: params.propertyId ?? null,
      event_type: params.eventType,
      direction: params.direction ?? "debit",
      amount: params.amount ?? null,
      currency: params.currency ?? "USD",
      billing_period: params.billingPeriod ?? null,
      description: params.description ?? null,
      metadata: params.metadata ?? {},
    })
    .select("id")
    .single()

  if (error) {
    console.error("[ledger-events] insert", params.eventType, error.message)
    return null
  }

  return (data?.id as string | undefined) ?? null
}
