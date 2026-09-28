/**
 * Startup / monitoring check: required timed Edge jobs missing from cron.job.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  REQUIRED_CRON_JOBS,
  type RequiredCronJob,
} from "../../../shared/ops/requiredCronJobs.ts"

export type MissingRequiredCronRow = RequiredCronJob

export type PausedRequiredCronRow = {
  jobname: string
  edgeFunction: string
  schedule: string
  description: string
  pauseReason: string | null
  pauseOwner: string | null
  resumeBy: string | null
  pausedAt: string | null
  resumeOverdue: boolean
}

/**
 * Calls public.ulo_missing_required_cron_jobs() (active cron.job gaps).
 * Returns [] when the RPC is unavailable (local / pre-migration).
 */
export async function loadMissingRequiredCronJobs(
  supabase: SupabaseClient,
): Promise<MissingRequiredCronRow[]> {
  const { data, error } = await supabase.rpc("ulo_missing_required_cron_jobs")
  if (error) {
    console.warn(
      "[missing-required-crons] RPC unavailable;",
      REQUIRED_CRON_JOBS.length,
      "required jobs in registry:",
      error.message,
    )
    return []
  }
  if (!Array.isArray(data)) return []
  return data
    .map((row: Record<string, unknown>) => ({
      jobname: String(row.jobname ?? ""),
      edgeFunction: String(row.edge_function ?? ""),
      schedule: String(row.schedule ?? ""),
      description: String(row.description ?? ""),
    }))
    .filter((row) => row.jobname && row.edgeFunction)
}

/** Intentionally paused required jobs (resume_by + overdue flag). */
export async function loadPausedRequiredCronJobs(
  supabase: SupabaseClient,
): Promise<PausedRequiredCronRow[]> {
  const { data, error } = await supabase.rpc("ulo_paused_required_cron_jobs")
  if (error) {
    console.warn("[paused-required-crons] RPC unavailable:", error.message)
    return []
  }
  if (!Array.isArray(data)) return []
  return data
    .map((row: Record<string, unknown>) => ({
      jobname: String(row.jobname ?? ""),
      edgeFunction: String(row.edge_function ?? ""),
      schedule: String(row.schedule ?? ""),
      description: String(row.description ?? ""),
      pauseReason:
        row.pause_reason == null ? null : String(row.pause_reason),
      pauseOwner: row.pause_owner == null ? null : String(row.pause_owner),
      resumeBy: row.resume_by == null ? null : String(row.resume_by),
      pausedAt: row.paused_at == null ? null : String(row.paused_at),
      resumeOverdue: row.resume_overdue === true,
    }))
    .filter((row) => row.jobname)
}

/** Log missing jobs so ops sees deployed-but-unscheduled gaps. */
export async function reportMissingRequiredCronJobs(
  supabase: SupabaseClient,
  opts?: { landlordId?: string | null },
): Promise<MissingRequiredCronRow[]> {
  const missing = await loadMissingRequiredCronJobs(supabase)
  if (missing.length === 0) return missing

  console.error(
    JSON.stringify({
      event: "required_cron_jobs_missing",
      count: missing.length,
      jobs: missing.map((j) => ({
        jobname: j.jobname,
        edge_function: j.edgeFunction,
        schedule: j.schedule,
      })),
      at: new Date().toISOString(),
    }),
  )

  const landlordId = opts?.landlordId?.trim() || null
  if (landlordId) {
    try {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "ops.required_cron_missing",
        source: "automation",
        actorType: "system",
        metadata: {
          message: `Required scheduled jobs are missing from pg_cron: ${
            missing.map((j) => j.edgeFunction).join(", ")
          }.`,
          missing_jobs: missing.map((j) => j.jobname),
        },
      })
    } catch (e) {
      console.error("[missing-required-crons] activity log", e)
    }
  }

  return missing
}

/** Log paused jobs (and flag overdue resume_by). */
export async function reportPausedRequiredCronJobs(
  supabase: SupabaseClient,
): Promise<PausedRequiredCronRow[]> {
  const paused = await loadPausedRequiredCronJobs(supabase)
  if (paused.length === 0) return paused

  const overdue = paused.filter((j) => j.resumeOverdue)
  console.warn(
    JSON.stringify({
      event: "required_cron_jobs_paused",
      count: paused.length,
      overdue_count: overdue.length,
      jobs: paused.map((j) => ({
        jobname: j.jobname,
        edge_function: j.edgeFunction,
        resume_by: j.resumeBy,
        resume_overdue: j.resumeOverdue,
        pause_reason: j.pauseReason,
        pause_owner: j.pauseOwner,
      })),
      at: new Date().toISOString(),
    }),
  )
  if (overdue.length > 0) {
    console.error(
      JSON.stringify({
        event: "required_cron_pause_resume_overdue",
        count: overdue.length,
        jobs: overdue.map((j) => j.jobname),
        at: new Date().toISOString(),
      }),
    )
  }
  return paused
}
