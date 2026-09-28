/**
 * Cron jobs that application logic depends on (X-hour / daily automation).
 * Deployed Edge Functions without a matching pg_cron.job entry are a class of
 * outage — see WO-5FA6 (vendor-delayed-auto-reassign never ran).
 *
 * Keep in sync with supabase/migrations/*_schedule_required_ops_crons*.sql
 * and the seed rows in public.ulo_required_cron_jobs.
 */

export type RequiredCronJob = {
  /** cron.job.jobname */
  jobname: string
  /** Edge Function path segment under /functions/v1/ */
  edgeFunction: string
  /** cron schedule expression */
  schedule: string
  /** Why this must stay scheduled (product / SLA contract). */
  description: string
}

export const REQUIRED_CRON_JOBS: readonly RequiredCronJob[] = [
  {
    jobname: "ulo-ops-sms-crons",
    edgeFunction: "run-ops-sms-crons",
    schedule: "10 * * * *",
    description:
      "Hourly tenant activation silence/delivery retries and rent reminder cadence",
  },
  {
    jobname: "ulo-vendor-delayed-auto-reassign",
    edgeFunction: "vendor-delayed-auto-reassign",
    schedule: "25 * * * *",
    description:
      "Hourly SLA-expired rematch and 48h pending_accept_stale auto-reassign",
  },
  {
    jobname: "ulo-workflow-escalations",
    edgeFunction: "run-workflow-escalations",
    schedule: "40 * * * *",
    description:
      "Hourly workflow escalation (incl. vendor onboarding 48h silence nudges)",
  },
  {
    jobname: "ulo-vendor-incident-protocols",
    edgeFunction: "check-vendor-incident-protocols",
    schedule: "*/5 * * * *",
    description: "Every 5 minutes — vendor no-show T+120 / T+125 rematch",
  },
  {
    jobname: "ulo-schedule-fsm-ttl",
    edgeFunction: "check-schedule-fsm-ttl",
    schedule: "*/15 * * * *",
    description: "Every 15 minutes — expire stalled vendor schedule FSM threads",
  },
  {
    jobname: "ulo-vendor-compliance-expiry",
    edgeFunction: "check-vendor-compliance-expiry",
    schedule: "15 6 * * *",
    description: "Daily COI/license expiry warnings and auto-suspend",
  },
  {
    jobname: "ulo-vendor-performance-standards",
    edgeFunction: "check-vendor-performance-standards",
    schedule: "30 6 * * *",
    description: "Daily vendor performance standards coaching / review",
  },
  {
    jobname: "ulo-lease-renewals",
    edgeFunction: "check-lease-renewals",
    schedule: "0 7 * * *",
    description: "Daily lease renewal workflow starts",
  },
] as const

export function requiredCronJobByName(
  jobname: string,
): RequiredCronJob | undefined {
  return REQUIRED_CRON_JOBS.find((row) => row.jobname === jobname)
}

export function requiredCronJobByEdgeFunction(
  edgeFunction: string,
): RequiredCronJob | undefined {
  return REQUIRED_CRON_JOBS.find((row) => row.edgeFunction === edgeFunction)
}

/** Pure: which required jobs are missing from a list of scheduled job names. */
export function findMissingRequiredCronJobs(
  scheduledJobNames: Iterable<string>,
): RequiredCronJob[] {
  const have = new Set(
    [...scheduledJobNames].map((name) => name.trim()).filter(Boolean),
  )
  return REQUIRED_CRON_JOBS.filter((job) => !have.has(job.jobname))
}
