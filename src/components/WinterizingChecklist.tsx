import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'
import type { WinterizingChecklistItem } from '@shared/weather/weatherMonitor'

type TaskRow = {
  id: string
  title: string
  status: string
  checklist: WinterizingChecklistItem[]
}

export function WinterizingChecklist({
  propertyId,
}: {
  propertyId: string | null | undefined
}) {
  const [task, setTask] = useState<TaskRow | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase || !propertyId) {
        setTask(null)
        return
      }
      const { data } = await supabase
        .from('preventive_maintenance_tasks')
        .select('id, title, status, metadata')
        .eq('landlord_id', getActiveLandlordId())
        .eq('task_kind', 'service')
        .limit(200)
      if (cancelled) return
      const match = (data ?? []).find((row) => {
        const metadata = row.metadata as { kind?: string; property_id?: string } | null
        return metadata?.kind === 'winterizing' && metadata.property_id === propertyId
      })
      if (!match) {
        setTask(null)
        return
      }
      const metadata = match.metadata as { checklist?: WinterizingChecklistItem[] }
      setTask({
        id: String(match.id),
        title: String(match.title ?? 'Winterizing checklist'),
        status: String(match.status ?? 'scheduled'),
        checklist: Array.isArray(metadata.checklist) ? metadata.checklist : [],
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [propertyId])

  if (!task) return null

  async function save(next: WinterizingChecklistItem[], done: boolean) {
    if (!supabase || !task) return
    const status = done ? 'completed' : 'scheduled'
    setTask({ ...task, checklist: next, status })
    await supabase
      .from('preventive_maintenance_tasks')
      .update({
        status,
        completed_at: done ? new Date().toISOString() : null,
        metadata: {
          kind: 'winterizing',
          property_id: propertyId,
          checklist: next,
        },
      })
      .eq('id', task.id)
    await recordActivityLog({
      landlordId: getActiveLandlordId(),
      eventType: done ? 'maintenance.winterizing_completed' : 'maintenance.winterizing_updated',
      source: 'dashboard',
      actorType: 'landlord',
      propertyId: propertyId ?? null,
      metadata: {
        message: done ? 'Winterizing checklist marked done.' : 'Winterizing checklist updated.',
      },
    })
  }

  return (
    <section className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Upcoming service</h2>
      <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">{task.title}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {task.checklist.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-[14px] leading-5 text-[#101828]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[#155dfc]"
              checked={item.done || task.status === 'completed'}
              onChange={(event) => {
                const next = task.checklist.map((entry) =>
                  entry.key === item.key ? { ...entry, done: event.target.checked } : entry,
                )
                void save(next, next.every((entry) => entry.done))
              }}
            />
            <span>
              {item.label}
              {item.linkedTaskId ? ' — furnace tune-up already scheduled' : ''}
            </span>
          </li>
        ))}
      </ul>
      {task.status !== 'completed' ? (
        <button
          type="button"
          className="admin-quiet-text-action sa-link mt-3"
          onClick={() => {
            const next = task.checklist.map((item) => ({ ...item, done: true }))
            void save(next, true)
          }}
        >
          Mark done
        </button>
      ) : (
        <p className="mt-3 text-[13px] text-[#6a7282]">Checklist complete.</p>
      )}
    </section>
  )
}
