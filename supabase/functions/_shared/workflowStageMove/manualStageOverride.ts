/**
 * Manual Active Tasks stage moves suppress contradictory automation for 24h
 * until a new real vendor/tenant event clears the override.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"

export const MANUAL_STAGE_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000

export type ManualStageOverride = {
  stage: string
  at: string
  by: string
}

export function readManualStageOverride(
  metadata: Record<string, unknown> | null | undefined,
): ManualStageOverride | null {
  const raw = metadata?.manual_stage_override
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const stage = typeof o.stage === "string" ? o.stage.trim() : ""
  const at = typeof o.at === "string" ? o.at.trim() : ""
  const by = typeof o.by === "string" ? o.by.trim() : ""
  if (!stage || !at) return null
  return { stage, at, by: by || "landlord" }
}

export function isManualStageOverrideFresh(
  override: ManualStageOverride | null | undefined,
  now = new Date(),
): boolean {
  if (!override?.at) return false
  const atMs = Date.parse(override.at)
  if (!Number.isFinite(atMs)) return false
  return now.getTime() - atMs < MANUAL_STAGE_OVERRIDE_TTL_MS
}

export async function loadFreshManualStageOverrideForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  now = new Date(),
): Promise<{ runId: string | null; override: ManualStageOverride | null; fresh: boolean }> {
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, metadata")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .in("status", ["active", "escalated", "completed"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run?.id) return { runId: null, override: null, fresh: false }
  const override = readManualStageOverride(
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : null,
  )
  return {
    runId: String(run.id),
    override,
    fresh: isManualStageOverrideFresh(override, now),
  }
}

/**
 * When automation would contradict a fresh manual move, log and skip.
 * Returns true when the caller should suppress.
 */
export async function shouldSuppressAutomationForManualOverride(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    landlordId: string
    reason: string
    now?: Date
  },
): Promise<boolean> {
  const loaded = await loadFreshManualStageOverrideForTicket(
    supabase,
    params.ticketId,
    params.now ?? new Date(),
  )
  if (!loaded.fresh || !loaded.override) return false

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "automation_suppressed_manual_override",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    workflowRunId: loaded.runId,
    metadata: {
      message: "Automation skipped because you recently moved this card on Active Tasks.",
      reason: params.reason,
      override_stage: loaded.override.stage,
      override_at: loaded.override.at,
    },
  }).catch(() => {})

  return true
}

/**
 * A new real vendor/tenant event clears the override so automation continues
 * from the landlord's chosen state.
 */
export async function clearManualStageOverrideForTicket(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    reason: string
  },
): Promise<boolean> {
  const { data: runs } = await supabase
    .from("workflow_runs")
    .select("id, metadata")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", params.ticketId)
    .in("status", ["active", "escalated", "completed"])
    .limit(8)

  let cleared = false
  for (const run of runs ?? []) {
    const meta =
      run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? { ...(run.metadata as Record<string, unknown>) }
        : {}
    if (!meta.manual_stage_override) continue
    delete meta.manual_stage_override
    meta.manual_stage_override_cleared_at = new Date().toISOString()
    meta.manual_stage_override_cleared_reason = params.reason
    await updateWorkflowRun(supabase, String(run.id), {
      metadata: meta,
      eventStep: "manual_override_cleared",
      eventMessage: "Manual stage override cleared after a new update.",
    })
    cleared = true
  }
  return cleared
}
