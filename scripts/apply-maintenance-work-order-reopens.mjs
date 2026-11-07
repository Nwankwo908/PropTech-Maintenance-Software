#!/usr/bin/env node
/**
 * Apply 20261107120000_maintenance_work_order_reopens.sql to the linked live project
 * via the Supabase Management database/query API.
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'mzpqwuizhiaczxcnmxbt'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION = join(
  ROOT,
  'supabase/migrations/20261107120000_maintenance_work_order_reopens.sql',
)

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    return process.env.SUPABASE_ACCESS_TOKEN.trim()
  }
  const path = join(homedir(), '.supabase', 'access-token')
  if (!existsSync(path)) throw new Error('Missing ~/.supabase/access-token')
  return readFileSync(path, 'utf8').trim()
}

async function sql(token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`DB query failed (${res.status}): ${text.slice(0, 1200)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function firstRow(result) {
  if (Array.isArray(result)) return result[0] ?? null
  return result
}

async function main() {
  const token = loadToken()
  const before = firstRow(
    await sql(
      token,
      `
      select
        to_regclass('public.maintenance_work_order_reopens')::text as table_reg,
        exists(
          select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'record_maintenance_work_order_reopen'
        ) as has_rpc,
        exists(
          select 1 from supabase_migrations.schema_migrations
          where version = '20261107120000'
        ) as has_migration_row
      `,
    ),
  )
  console.log('BEFORE', JSON.stringify(before))

  if (!before?.table_reg || !before?.has_migration_row) {
    const migrationSql = readFileSync(MIGRATION, 'utf8')
    console.log('APPLYING', MIGRATION, 'bytes=', migrationSql.length)
    const apply = await sql(token, migrationSql)
    console.log('APPLY_RESULT', JSON.stringify(apply).slice(0, 400))

    try {
      await sql(
        token,
        `
        insert into supabase_migrations.schema_migrations (version, name)
        values ('20261107120000', 'maintenance_work_order_reopens')
        on conflict (version) do nothing
        `,
      )
    } catch (err) {
      console.warn('insert_with_name_failed', String(err).slice(0, 200))
      await sql(
        token,
        `
        insert into supabase_migrations.schema_migrations (version)
        values ('20261107120000')
        on conflict (version) do nothing
        `,
      )
    }
  } else {
    console.log('Already present; skipping apply')
  }

  const after = firstRow(
    await sql(
      token,
      `
      select
        to_regclass('public.maintenance_work_order_reopens')::text as table_reg,
        exists(
          select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'record_maintenance_work_order_reopen'
        ) as has_rpc,
        exists(
          select 1 from pg_trigger
          where tgname = 'trg_maintenance_request_reopen'
        ) as has_trigger,
        exists(
          select 1 from supabase_migrations.schema_migrations
          where version = '20261107120000'
        ) as has_migration_row
      `,
    ),
  )
  console.log('AFTER', JSON.stringify(after))
  if (!after?.table_reg || !after?.has_rpc || !after?.has_trigger || !after?.has_migration_row) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
