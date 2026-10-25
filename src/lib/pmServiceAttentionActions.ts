import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'

/** Mark the batch resolved in the app so a later YES HVAC text sees the same item. */
export async function persistPmServiceAppResolution(input: {
  batchId: string
  taskIds: string[]
  summary: string
  snoozedUntil?: string | null
}): Promise<void> {
  if (!supabase) return
  const landlordId = getActiveLandlordId()
  const { data } = await supabase
    .from('preventive_maintenance_tasks')
    .select('id, metadata')
    .eq('landlord_id', landlordId)
    .limit(500)
  const rows = (data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>
  const targets = rows.filter((row) => (row.metadata ?? {}).pm_batch_id === input.batchId)
  for (const row of targets) {
    const meta = row.metadata ?? {}
    const approved = input.snoozedUntil ? false : input.taskIds.includes(row.id)
    await supabase
      .from('preventive_maintenance_tasks')
      .update({
        metadata: {
          ...meta,
          ...(input.snoozedUntil
            ? { snoozed_until: input.snoozedUntil }
            : {
                pm_resolution: 'app',
                pm_phase: approved ? 'scheduled' : 'declined',
              }),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  }
  await recordActivityLog({
    landlordId,
    eventType: input.snoozedUntil ? 'pm_service.snoozed' : 'pm_service.approved',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: input.snoozedUntil
        ? 'Preventive HVAC reminder snoozed for 3 days.'
        : input.summary,
      batchId: input.batchId,
    },
  })
}
