import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  computePortfolioIntelligence,
  type PortfolioTicketRow,
  type PortfolioUnitRow,
  type PortfolioWorkflowRow,
} from './index.ts'

function mergeTickets(a: PortfolioTicketRow[], b: PortfolioTicketRow[]): PortfolioTicketRow[] {
  const byId = new Map<string, PortfolioTicketRow>()
  for (const row of [...a, ...b]) {
    const key = row.id?.trim() || `${row.unit}|${row.createdAt}|${row.issueCategory}`
    byId.set(key, row)
  }
  return [...byId.values()]
}

function vendorResponsePct(tickets: PortfolioTicketRow[]): {
  pct: number | null
  assigned: number
} {
  const assigned = tickets.filter((t) => t.assignedVendorId)
  if (assigned.length === 0) return { pct: null, assigned: 0 }
  const responded = assigned.filter((t) => {
    const s = (t.vendorWorkStatus ?? '').trim().toLowerCase()
    return s && s !== 'pending_accept'
  })
  return {
    pct: Math.round((responded.length / assigned.length) * 100),
    assigned: assigned.length,
  }
}

function mapTicketRow(row: Record<string, unknown>): PortfolioTicketRow {
  return {
    id: String(row.id ?? ''),
    building: typeof row.building === 'string' ? row.building : null,
    unit: typeof row.unit === 'string' ? row.unit : null,
    issueCategory: typeof row.issue_category === 'string' ? row.issue_category : null,
    vendorWorkStatus: typeof row.vendor_work_status === 'string' ? row.vendor_work_status : null,
    createdAt: String(row.created_at ?? ''),
    assignedVendorId:
      typeof row.assigned_vendor_id === 'string' ? row.assigned_vendor_id : null,
    urgency: typeof row.urgency === 'string' ? row.urgency : null,
  }
}

export async function loadPortfolioIntelligenceInput(
  supabase: SupabaseClient,
  landlordId: string,
) {
  const id = landlordId.trim()
  const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const [recentRes, openRes, unitsRes, workflowsRes] = await Promise.all([
    supabase
      .from('maintenance_request_enriched')
      .select(
        'id, building, unit, issue_category, vendor_work_status, created_at, assigned_vendor_id, urgency',
      )
      .eq('landlord_id', id)
      .gte('created_at', since60)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('maintenance_request_enriched')
      .select(
        'id, building, unit, issue_category, vendor_work_status, created_at, assigned_vendor_id, urgency',
      )
      .eq('landlord_id', id)
      .not('vendor_work_status', 'in', '("completed","cancelled","closed","resolved")')
      .order('created_at', { ascending: false })
      .limit(400),
    supabase.from('units').select('unit_label, building').eq('landlord_id', id).limit(500),
    supabase
      .from('workflow_runs')
      .select('id, status, template_id, metadata')
      .eq('landlord_id', id)
      .in('status', ['active', 'escalated'])
      .order('updated_at', { ascending: false })
      .limit(80),
  ])

  const recentTickets = (recentRes.data ?? []).map((row) =>
    mapTicketRow(row as Record<string, unknown>),
  )
  const openTickets = (openRes.data ?? []).map((row) =>
    mapTicketRow(row as Record<string, unknown>),
  )
  const tickets = mergeTickets(recentTickets, openTickets)

  const units: PortfolioUnitRow[] = (unitsRes.data ?? []).map((row) => ({
    unitLabel: typeof row.unit_label === 'string' ? row.unit_label : null,
    building: typeof row.building === 'string' ? row.building : null,
  }))

  const escalatedWorkflows: PortfolioWorkflowRow[] = (workflowsRes.data ?? []).map((row) => {
    const meta =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {}
    const building =
      typeof meta.building === 'string'
        ? meta.building
        : typeof meta.property_name === 'string'
          ? meta.property_name
          : null
    return {
      id: String(row.id ?? ''),
      status: String(row.status ?? ''),
      building,
      templateName: typeof row.template_id === 'string' ? row.template_id : null,
    }
  })

  const { pct, assigned } = vendorResponsePct(tickets)

  return {
    tickets,
    units,
    vendorResponsePct: pct,
    assignedWorkOrderCount: assigned,
    escalatedWorkflows,
    now: Date.now(),
  }
}

export async function evaluatePortfolioIntelligence(
  supabase: SupabaseClient,
  landlordId: string,
) {
  const input = await loadPortfolioIntelligenceInput(supabase, landlordId)
  return computePortfolioIntelligence(input)
}
