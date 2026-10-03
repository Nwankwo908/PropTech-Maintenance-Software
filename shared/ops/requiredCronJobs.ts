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
      "Hourly tenant activation silence/delivery retries, mid-intake silence nudge/resolve, and rent reminder cadence",
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
    jobname: "ulo-maintenance-stall-follow-up",
    edgeFunction: "check-maintenance-stall-follow-up",
    schedule: "35 * * * *",
    description:
      "Hourly stall follow-up for unfinished maintenance (vendor/resident; not rent)",
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
  {
    jobname: "ulo-ticket-unit-fk-audit",
    edgeFunction: "check-ticket-unit-fk-mismatches",
    schedule: "45 5 * * *",
    description:
      "Daily audit of ticket/conversation unit_id vs resident occupancy (fail-closed FK drift)",
  },
  {
    jobname: "ulo-vendor-choice-trigger-audit",
    edgeFunction: "check-vendor-choice-trigger-audit",
    schedule: "50 5 * * *",
    description:
      "Daily audit of landlord vendor-choice assignments without a durable confirming inbound SMS",
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
