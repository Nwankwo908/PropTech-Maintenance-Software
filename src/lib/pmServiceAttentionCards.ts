import type { PmServiceBatchSnapshot, PmServiceUnitSnapshot, PmServiceVisitPhase } from '@shared/pm/pmServiceAttention'

const PHASES = new Set<PmServiceVisitPhase>([
  'proposed',
  'scheduled',
  'confirmed',
  'completed',
  'declined',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function phaseOf(meta: Record<string, unknown>, status: string): PmServiceVisitPhase | null {
  const raw = asString(meta.pm_phase)
  if (raw && PHASES.has(raw as PmServiceVisitPhase)) return raw as PmServiceVisitPhase
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'completed'
  return null
}

export type PmTaskAttentionRow = {
  id: string
  title: string | null
  status: string | null
  dueAt: string | null
  unitLabel: string | null
  building: string | null
  metadata: unknown
}

/** Group tagged preventive HVAC tasks into the batches the attention cards use. */
export function batchesFromPmTaskRows(rows: PmTaskAttentionRow[]): PmServiceBatchSnapshot[] {
  const groups = new Map<string, PmServiceBatchSnapshot>()
  for (const row of rows) {
    const meta = asRecord(row.metadata)
    const batchId = asString(meta.pm_batch_id)
    const phase = phaseOf(meta, (row.status ?? '').toLowerCase())
    if (!batchId || !phase) continue
    const unit: PmServiceUnitSnapshot = {
      id: row.id,
      planId: asString(meta.pm_plan_id) ?? row.id,
      unitLabel: row.unitLabel?.trim() || 'Home',
      vendorName: asString(meta.vendor_name),
      cost: typeof meta.cost === 'number' ? meta.cost : null,
      phase,
      taskStatus: (row.status ?? '').toLowerCase() as PmServiceUnitSnapshot['taskStatus'],
      windowStart: asString(meta.window_start),
      windowEnd: asString(meta.window_end) ?? row.dueAt,
      visitAt: asString(meta.visit_at),
      vendorAskedAt: asString(meta.vendor_asked_at),
      vendorResponse:
        meta.vendor_response === 'pending' ||
        meta.vendor_response === 'declined' ||
        meta.vendor_response === 'available'
          ? meta.vendor_response
          : null,
      tenantConfirmed: meta.tenant_confirmed === true,
      completionNotes: asString(meta.completion_notes),
      rescheduled: meta.rescheduled === true,
    }
    const existing = groups.get(batchId)
    if (existing) {
      existing.units.push(unit)
      continue
    }
    const resolution = asString(meta.pm_resolution)
    groups.set(batchId, {
      batchId,
      propertyLabel: row.building?.trim() || row.title?.trim() || 'Property',
      units: [unit],
      resolution:
        resolution === 'app' || resolution === 'sms' || resolution === 'declined' ? resolution : null,
      snoozedUntil: asString(meta.snoozed_until),
    })
  }
  return [...groups.values()]
}
