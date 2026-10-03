import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REQUIRED_CRON_JOBS,
  findMissingRequiredCronJobs,
  requiredCronJobByEdgeFunction,
} from './requiredCronJobs.ts'

const MIGRATION_GLOB_HINT = 'schedule_required_ops_crons'
const PAUSE_MIGRATION_HINT = 'cron_pause_registry'

function readRequiredCronMigrationSql(): string {
  const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter(
    (name) =>
      name.includes(MIGRATION_GLOB_HINT) ||
      name.includes('maintenance_stall_follow_up') ||
      name.includes('ticket_unit_fk_audit') ||
      name.includes('vendor_choice_trigger_audit'),
  )
  expect(files.length).toBeGreaterThanOrEqual(1)
  return files
    .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))
    .join('\n')
}

function readPauseRegistryMigrationSql(): string {
  const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter((name) =>
    name.includes(PAUSE_MIGRATION_HINT),
  )
  expect(files.length).toBeGreaterThanOrEqual(1)
  return readFileSync(resolve(migrationsDir, files[0]!), 'utf8')
}

describe('requiredCronJobs', () => {
  it('includes vendor-delayed-auto-reassign as a required scheduled job', () => {
    const job = requiredCronJobByEdgeFunction('vendor-delayed-auto-reassign')
    expect(job).toBeDefined()
    expect(job!.jobname).toBe('ulo-vendor-delayed-auto-reassign')
    expect(job!.schedule).toMatch(/\S/)
  })

  it('flags missing cron.job names against the registry', () => {
    const missing = findMissingRequiredCronJobs(['ulo-ops-sms-crons'])
    expect(missing.map((j) => j.edgeFunction)).toContain(
      'vendor-delayed-auto-reassign',
    )
    expect(
      findMissingRequiredCronJobs(REQUIRED_CRON_JOBS.map((j) => j.jobname)),
    ).toEqual([])
  })

  it('scheduling migration registers vendor-delayed-auto-reassign in cron.job', () => {
    const sql = readRequiredCronMigrationSql()
    expect(sql).toContain('cron.schedule')
    expect(sql).toContain('ulo_ensure_required_cron_jobs')
    expect(sql).toContain('ulo_invoke_edge_function')
    expect(sql).toContain('ulo-vendor-delayed-auto-reassign')
    expect(sql).toContain("'vendor-delayed-auto-reassign'")
    expect(sql).toContain('ulo_required_cron_jobs')
    expect(sql).toContain('ulo_missing_required_cron_jobs')
    for (const job of REQUIRED_CRON_JOBS) {
      expect(sql).toContain(job.jobname)
      expect(sql).toContain(job.edgeFunction)
    }
  })

  it('pause registry migration preserves inactive paused jobs on ensure', () => {
    const sql = readPauseRegistryMigrationSql()
    expect(sql).toContain("status = 'paused'")
    expect(sql).toContain('resume_by')
    expect(sql).toContain('ulo_paused_required_cron_jobs')
    expect(sql).toContain('active := false')
    expect(sql).toContain("rec.status = 'paused'")
    expect(sql).toContain('ulo-vendor-delayed-auto-reassign')
    expect(sql).toMatch(/if rec\.status = 'paused'[\s\S]*active := false/)
  })
})
