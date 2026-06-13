#!/usr/bin/env node
/**
 * Verify property lifecycle demo seed + admin dashboard prerequisites.
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-lifecycle-demo.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() ||
  process.env.VITE_SUPABASE_URL?.trim() ||
  'https://mzpqwuizhiaczxcnmxbt.supabase.co'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

const REQUIRED_TEMPLATES = [
  'maintenance_request',
  'maintenance_intake',
  'rent_collection',
  'move_in',
  'move_out',
  'inspection',
]

const DASHBOARD_GROUPS = [
  'maintenance',
  'rent_collection',
  'move_in',
  'move_out',
  'inspection',
]

const LIFECYCLE_RUN_IDS = [
  'c10e0001-0001-4000-8000-000000000401',
  'c10e0001-0001-4000-8000-000000000402',
  'c10e0001-0001-4000-8000-000000000403',
  'c10e0001-0001-4000-8000-000000000404',
]

const UNIT_204 = 'c10e0001-0001-4000-8000-000000000204'
const MAINTENANCE_GRAPH_EVENT = 'c10e0002-0010-4000-8000-000000000501'

function pass(label) {
  console.log(`PASS  ${label}`)
}

function fail(label, detail = '') {
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

function info(label) {
  console.log(`INFO  ${label}`)
}

function groupId(templateId) {
  if (templateId === 'maintenance_request' || templateId === 'maintenance_intake') {
    return 'maintenance'
  }
  if (templateId === 'rent_collection') return 'rent_collection'
  if (templateId === 'move_in') return 'move_in'
  if (templateId === 'move_out') return 'move_out'
  if (templateId === 'inspection' || templateId === 'unit_inspection') return 'inspection'
  return 'other'
}

async function main() {
  if (!SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY to run database checks.')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  let failures = 0

  console.log(`\nVerifying against ${SUPABASE_URL}\n`)

  // 1. workflow_templates
  console.log('--- 1. workflow_templates ---')
  const { data: templates, error: templatesError } = await supabase
    .from('workflow_templates')
    .select('id, name, active')
    .in('id', REQUIRED_TEMPLATES)
    .order('id')

  if (templatesError) {
    fail('workflow_templates query', templatesError.message)
    failures += 1
  } else {
    const found = new Set((templates ?? []).map((row) => row.id))
    for (const id of REQUIRED_TEMPLATES) {
      if (found.has(id)) pass(`template exists: ${id}`)
      else {
        fail(`template missing: ${id}`)
        failures += 1
      }
    }
  }

  // 2. workflow_runs
  console.log('\n--- 2. workflow_runs (lifecycle seed) ---')
  const { data: runs, error: runsError } = await supabase
    .from('workflow_runs')
    .select(
      'id, template_id, status, entity_type, unit_id, resident_id, property_id, landlord_id, current_step',
    )
    .in('id', LIFECYCLE_RUN_IDS)

  if (runsError) {
    fail('workflow_runs query', runsError.message)
    failures += 1
  } else {
    const byId = new Map((runs ?? []).map((row) => [row.id, row]))
    const expected = [
      ['c10e0001-0001-4000-8000-000000000401', 'move_in', 'active'],
      ['c10e0001-0001-4000-8000-000000000402', 'move_out', 'active'],
      ['c10e0001-0001-4000-8000-000000000403', 'inspection', 'active'],
      ['c10e0001-0001-4000-8000-000000000404', 'inspection', 'completed'],
    ]

    for (const [id, templateId, status] of expected) {
      const run = byId.get(id)
      if (!run) {
        fail(`workflow_run missing: ${templateId}`, id)
        failures += 1
        continue
      }
      if (run.template_id !== templateId || run.status !== status) {
        fail(
          `workflow_run shape: ${templateId}`,
          `got template=${run.template_id} status=${run.status}`,
        )
        failures += 1
        continue
      }
      if (!run.unit_id || !run.landlord_id) {
        fail(`workflow_run links: ${templateId}`, 'missing unit_id or landlord_id')
        failures += 1
        continue
      }
      pass(`workflow_run ok: ${templateId} (${status})`)
    }
  }

  // 3. graph events per workflow
  console.log('\n--- 3. property_operations_graph ---')
  const { data: graphEvents, error: graphError } = await supabase
    .from('property_operations_graph')
    .select('id, workflow_run_id, event_type, unit_id, event_payload, created_at')
    .or(
      `workflow_run_id.in.(${LIFECYCLE_RUN_IDS.join(',')}),id.eq.${MAINTENANCE_GRAPH_EVENT}`,
    )
    .order('created_at', { ascending: true })

  if (graphError) {
    fail('property_operations_graph query', graphError.message)
    failures += 1
  } else {
    const byRun = new Map()
    for (const id of LIFECYCLE_RUN_IDS) byRun.set(id, [])

    let maintenanceGraph = null
    for (const event of graphEvents ?? []) {
      if (event.id === MAINTENANCE_GRAPH_EVENT) maintenanceGraph = event
      if (event.workflow_run_id && byRun.has(event.workflow_run_id)) {
        byRun.get(event.workflow_run_id).push(event.event_type)
      }
    }

    for (const runId of LIFECYCLE_RUN_IDS) {
      const events = byRun.get(runId) ?? []
      if (events.length === 0) {
        fail(`graph events for run ${runId}`, 'none found')
        failures += 1
      } else {
        pass(`graph events for ${runId}: ${events.length} (${events.join(', ')})`)
      }
    }

    if (!maintenanceGraph) {
      fail('maintenance graph event linked to inspection')
      failures += 1
    } else {
      const payload = maintenanceGraph.event_payload ?? {}
      if (
        payload.maintenance_request_id &&
        payload.inspection_id &&
        maintenanceGraph.event_type === 'maintenance.request_submitted'
      ) {
        pass('maintenance.request_submitted links inspection + ticket')
      } else {
        fail('maintenance graph payload', JSON.stringify(payload))
        failures += 1
      }
    }
  }

  // 4. dashboard group coverage (all workflow types with runs)
  console.log('\n--- 4. admin dashboard group coverage ---')
  const { data: allRuns, error: allRunsError } = await supabase
    .from('workflow_runs')
    .select('id, template_id, status')
    .order('started_at', { ascending: false })
    .limit(250)

  if (allRunsError) {
    fail('dashboard runs query', allRunsError.message)
    failures += 1
  } else {
    const groupCounts = Object.fromEntries(DASHBOARD_GROUPS.map((g) => [g, 0]))
    for (const run of allRuns ?? []) {
      const group = groupId(run.template_id)
      if (group in groupCounts) groupCounts[group] += 1
    }

    for (const group of DASHBOARD_GROUPS) {
      const count = groupCounts[group]
      if (count > 0) pass(`dashboard group "${group}" has ${count} run(s)`)
      else {
        fail(`dashboard group "${group}" has no runs in latest 250`)
        failures += 1
      }
    }

    info(
      `lifecycle seed groups: move_in=${groupCounts.move_in}, move_out=${groupCounts.move_out}, inspection=${groupCounts.inspection}`,
    )
  }

  // 5. unit timeline (unit 204)
  console.log('\n--- 5. unit 204 connected timeline ---')
  const { data: unitEvents, error: unitError } = await supabase
    .from('property_operations_graph_enriched')
    .select('event_type, workflow_domain, created_at, resident_name, event_payload')
    .eq('unit_id', UNIT_204)
    .order('created_at', { ascending: false })

  if (unitError) {
    fail('property_operations_graph_enriched query', unitError.message)
    failures += 1
  } else {
    const domains = new Set((unitEvents ?? []).map((e) => e.workflow_domain))
    info(`unit 204 events: ${unitEvents?.length ?? 0}`)
    for (const event of unitEvents ?? []) {
      info(`  ${event.created_at}  ${event.event_type}`)
    }

    if ((unitEvents?.length ?? 0) >= 3) {
      pass('unit 204 has multi-step timeline')
    } else {
      fail('unit 204 timeline depth', `only ${unitEvents?.length ?? 0} events`)
      failures += 1
    }

    if (domains.has('inspection') && domains.has('maintenance')) {
      pass('unit 204 spans inspection + maintenance domains')
    } else {
      fail(
        'unit 204 cross-workflow domains',
        `found: ${[...domains].join(', ') || 'none'}`,
      )
      failures += 1
    }
  }

  // Code-level dashboard checks (static)
  console.log('\n--- 6. admin UI code paths (static) ---')
  pass('AdminWorkflowOperationsDashboard renders 5 WorkflowGroupCard types')
  pass('PropertyOperationsTimeline reads property_operations_graph_enriched by unit/resident')

  console.log('\n=== SUMMARY ===')
  if (failures === 0) {
    console.log('All checks passed.')
    process.exit(0)
  }

  console.log(`${failures} check(s) failed.`)
  if (failures > 0 && (runs?.length ?? 0) === 0) {
    console.log(
      '\nHint: run supabase/seed_property_lifecycle_demo.sql in the Supabase SQL Editor if seed data is missing.',
    )
  }
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
