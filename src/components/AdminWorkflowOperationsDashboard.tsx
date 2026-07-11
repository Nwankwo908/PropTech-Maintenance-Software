import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  startLifecycleWorkflow,
  loadResidentsForUnit,
  loadUnitsForWorkflowPicker,
  type InspectionType,
  type LifecycleWorkflowType,
  type ResidentOption,
  type UnitOption,
} from '@/api/lifecycleWorkflow'
import {
  fetchAdminWorkflowDashboard,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_KANBAN_STAGES,
  WORKFLOW_PIPELINE_MAINTENANCE_FILTER_HELPER,
  WORKFLOW_PIPELINE_PAGE_SUBTITLE,
  WORKFLOW_PIPELINE_SECTION_HELPER,
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  type WorkflowKanbanCard,
  type WorkflowKanbanCategory,
  type WorkflowKanbanStageId,
} from '@/lib/adminWorkflowKanban'
import { fetchWorkflowPipelineDetail, type WorkflowPipelineDetail } from '@/lib/workflowPipelineDetail'
import { WorkflowPipelineDetailPanel } from '@/components/WorkflowPipelineDetailPanel'
import { supabase } from '@/lib/supabase'

type StageId = WorkflowKanbanStageId
const STAGE_ORDER = WORKFLOW_KANBAN_STAGES
type Category = WorkflowKanbanCategory
const CATEGORY_BADGE = WORKFLOW_CATEGORY_BADGE
type KanbanCard = WorkflowKanbanCard

type PillId = 'all' | 'maintenance' | 'lease' | 'payment'

const FILTER_PILLS: { id: PillId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'lease', label: 'Lease' },
  { id: 'payment', label: 'Payment' },
]

function StartLifecycleWorkflowModal({
  open,
  workflow,
  onClose,
  onStarted,
}: {
  open: boolean
  workflow: LifecycleWorkflowType
  onClose: () => void
  onStarted: (workflowRunId: string) => void
}) {
  const unitSelectId = useId()
  const residentSelectId = useId()
  const dateInputId = useId()
  const inspectionTypeId = useId()

  const [units, setUnits] = useState<UnitOption[]>([])
  const [residents, setResidents] = useState<ResidentOption[]>([])
  const [unitId, setUnitId] = useState('')
  const [residentId, setResidentId] = useState('')
  const [moveInDate, setMoveInDate] = useState('')
  const [moveOutDate, setMoveOutDate] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [inspectionType, setInspectionType] = useState<InspectionType>('periodic')
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titles: Record<LifecycleWorkflowType, string> = {
    move_in: 'Start move-in workflow',
    move_out: 'Start move-out workflow',
    inspection: 'Start inspection workflow',
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setUnitId('')
    setResidentId('')
    setMoveInDate('')
    setMoveOutDate('')
    setScheduledAt('')
    setInspectionType('periodic')
    setLoadingUnits(true)
    void loadUnitsForWorkflowPicker()
      .then(setUnits)
      .finally(() => setLoadingUnits(false))
  }, [open, workflow])

  useEffect(() => {
    if (!unitId) {
      setResidents([])
      setResidentId('')
      return
    }
    void loadResidentsForUnit(unitId).then((list) => {
      setResidents(list)
      setResidentId(list.length === 1 ? list[0].id : '')
    })
  }, [unitId])

  if (!open) return null

  const selectedUnit = units.find((unit) => unit.id === unitId)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!unitId) {
      setError('Select a unit.')
      return
    }

    setSubmitting(true)
    setError(null)

    const result = await startLifecycleWorkflow({
      workflow,
      unitId,
      residentId: residentId || undefined,
      unitLabel: selectedUnit?.unit_label,
      building: selectedUnit?.building,
      moveInDate: workflow === 'move_in' ? moveInDate || undefined : undefined,
      moveOutDate: workflow === 'move_out' ? moveOutDate || undefined : undefined,
      scheduledAt: workflow === 'inspection' ? scheduledAt || undefined : undefined,
      inspectionType: workflow === 'inspection' ? inspectionType : undefined,
    })

    setSubmitting(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onStarted(result.workflow_run_id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-[10px] border border-secondary bg-white shadow-lg"
      >
        <div className="border-b border-secondary px-6 py-4">
          <h2 className="text-[16px] font-semibold text-extended-3">{titles[workflow]}</h2>
          <p className="mt-1 text-[13px] text-neutral">
            Creates a workflow run and logs the first graph event.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          {error ? (
            <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b52a00]">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor={unitSelectId} className="mb-1 block text-[13px] font-medium text-extended-3">
              Unit
            </label>
            <select
              id={unitSelectId}
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={loadingUnits || submitting}
              className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
            >
              <option value="">{loadingUnits ? 'Loading units…' : 'Select unit'}</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.unit_label}
                  {unit.building ? ` · ${unit.building}` : ''} ({unit.status})
                </option>
              ))}
            </select>
          </div>

          {residents.length ? (
            <div>
              <label
                htmlFor={residentSelectId}
                className="mb-1 block text-[13px] font-medium text-extended-3"
              >
                Resident (optional)
              </label>
              <select
                id={residentSelectId}
                value={residentId}
                onChange={(e) => setResidentId(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
              >
                <option value="">No resident selected</option>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.full_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {workflow === 'move_in' ? (
            <div>
              <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                Move-in date (optional)
              </label>
              <input
                id={dateInputId}
                type="date"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
              />
            </div>
          ) : null}

          {workflow === 'move_out' ? (
            <div>
              <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                Vacate date (optional)
              </label>
              <input
                id={dateInputId}
                type="date"
                value={moveOutDate}
                onChange={(e) => setMoveOutDate(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
              />
            </div>
          ) : null}

          {workflow === 'inspection' ? (
            <>
              <div>
                <label
                  htmlFor={inspectionTypeId}
                  className="mb-1 block text-[13px] font-medium text-extended-3"
                >
                  Inspection type
                </label>
                <select
                  id={inspectionTypeId}
                  value={inspectionType}
                  onChange={(e) => setInspectionType(e.target.value as InspectionType)}
                  disabled={submitting}
                  className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] outline-none focus:border-primary"
                >
                  <option value="move_in">Move-in</option>
                  <option value="move_out">Move-out</option>
                  <option value="periodic">Periodic</option>
                  <option value="annual">Annual</option>
                  <option value="common_area">Common area</option>
                </select>
              </div>
              <div>
                <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                  Scheduled at (optional)
                </label>
                <input
                  id={dateInputId}
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={submitting}
                  className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
                />
              </div>
            </>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-secondary px-4 text-[14px] font-medium text-extended-3 hover:bg-secondary disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !unitId}
              className="inline-flex h-9 cursor-pointer items-center rounded-[10px] bg-primary px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Starting…' : 'Start workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StartWorkflowChooser({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (workflow: LifecycleWorkflowType) => void
}) {
  if (!open) return null
  const options: { id: LifecycleWorkflowType; label: string; desc: string }[] = [
    { id: 'move_in', label: 'Move in', desc: 'Onboard a new resident into a unit.' },
    { id: 'move_out', label: 'Move out', desc: 'Vacate and turn over a unit.' },
    { id: 'inspection', label: 'Inspection', desc: 'Schedule a unit or common-area inspection.' },
  ]
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-[10px] border border-secondary bg-white p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3">
          <h2 className="text-[15px] font-semibold text-extended-3">Start a workflow</h2>
          <p className="mt-0.5 text-[12px] text-neutral">Choose a lifecycle workflow to launch.</p>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              className="flex cursor-pointer flex-col rounded-[10px] border border-secondary px-3 py-2.5 text-left transition-colors hover:bg-secondary"
            >
              <span className="text-[14px] font-medium text-extended-3">{opt.label}</span>
              <span className="text-[12px] text-neutral">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function KanbanCardItem({
  card,
  highlighted,
  onSelect,
}: {
  card: KanbanCard
  highlighted?: boolean
  onSelect: (runId: string) => void
}) {
  const badge = CATEGORY_BADGE[card.category]
  return (
    <button
      type="button"
      id={`workflow-card-${card.id}`}
      onClick={() => onSelect(card.id)}
      className={[
        'flex w-full flex-col gap-2 rounded-[10px] border bg-white p-3 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] transition-shadow outline-none hover:border-[#d1d5dc] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2',
        highlighted
          ? 'border-[#101828] ring-2 ring-[#101828]/20'
          : 'border-[#e5e7eb]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">
          {card.title}
        </p>
        {card.critical ? (
          <span className="mt-1 size-2 shrink-0 rounded-full bg-[#fb2c36]" aria-hidden />
        ) : null}
      </div>
      {card.context && card.context !== '—' ? (
        <p className="truncate text-[12px] leading-4 text-[#6a7282]">{card.context}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-[6px] px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        {card.initials ? (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-[10px] font-semibold text-white"
            aria-hidden
          >
            {card.initials}
          </span>
        ) : (
          <span className="size-6 shrink-0 rounded-full bg-[#e5e7eb]" aria-hidden />
        )}
      </div>
    </button>
  )
}

export function AdminWorkflowOperationsDashboard() {
  const [searchParams] = useSearchParams()
  const focusRunId = searchParams.get('run')?.trim() || null
  const [data, setData] = useState<AdminWorkflowDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<PillId>('all')
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null)

  const [chooserOpen, setChooserOpen] = useState(false)
  const [startModalWorkflow, setStartModalWorkflow] = useState<LifecycleWorkflowType | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [pipelineDetail, setPipelineDetail] = useState<WorkflowPipelineDetail | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)

  const allRuns = useMemo<AdminWorkflowRow[]>(() => {
    if (!data) return []
    return collectAdminWorkflowRuns(data)
  }, [data])

  const cards = useMemo<KanbanCard[]>(() => {
    const runMetadata = data?.runMetadata ?? {}
    const all = allRuns
      .filter((row) => row.status !== 'cancelled')
      .map((row) => buildWorkflowKanbanCard(row, runMetadata[row.id]))
    if (categoryFilter === 'all') return all
    const target: Category = categoryFilter === 'payment' ? 'payment' : categoryFilter
    return all.filter((card) => card.category === target)
  }, [allRuns, categoryFilter, data?.runMetadata])

  const columns = useMemo(() => {
    const byStage = new Map<StageId, KanbanCard[]>()
    for (const { id } of STAGE_ORDER) byStage.set(id, [])
    for (const card of cards) byStage.get(card.stage)?.push(card)
    return STAGE_ORDER.map((stage) => ({
      ...stage,
      cards: byStage.get(stage.id) ?? [],
    }))
  }, [cards])

  const activeCount = useMemo(
    () => cards.filter((card) => card.stage !== 'completed').length,
    [cards],
  )

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setData(await fetchAdminWorkflowDashboard())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusRunId || loading) return
    setSelectedRunId(focusRunId)
    const element = document.getElementById(`workflow-card-${focusRunId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setHighlightRunId(focusRunId)
    const timer = window.setTimeout(() => setHighlightRunId(null), 3200)
    return () => window.clearTimeout(timer)
  }, [focusRunId, loading, cards])

  useEffect(() => {
    if (!selectedRunId || !data) {
      setPipelineDetail(null)
      setPipelineLoading(false)
      return
    }

    let cancelled = false
    setPipelineLoading(true)
    setPipelineDetail(null)

    void fetchWorkflowPipelineDetail(selectedRunId, allRuns, data.runMetadata).then((result) => {
      if (cancelled) return
      setPipelineDetail(result)
      setPipelineLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [selectedRunId, data, allRuns])

  useEffect(() => {
    const client = supabase
    if (!client) return

    const channel = client
      .channel('admin-workflow-runs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workflow_runs' },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workflow_events' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [load])

  const pipelineHelperText =
    categoryFilter === 'maintenance'
      ? WORKFLOW_PIPELINE_MAINTENANCE_FILTER_HELPER
      : WORKFLOW_PIPELINE_SECTION_HELPER

  return (
    <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-8 pb-12">
      <div className="py-6">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Active Tasks
        </h1>
        <p className="mt-1 max-w-3xl text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          {WORKFLOW_PIPELINE_PAGE_SUBTITLE}
        </p>
      </div>

      <StartWorkflowChooser
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPick={(workflow) => {
          setChooserOpen(false)
          setStartModalWorkflow(workflow)
        }}
      />

      <StartLifecycleWorkflowModal
        open={startModalWorkflow != null}
        workflow={startModalWorkflow ?? 'move_in'}
        onClose={() => setStartModalWorkflow(null)}
        onStarted={() => void load()}
      />

      <WorkflowPipelineDetailPanel
        open={selectedRunId != null}
        detail={pipelineDetail}
        loading={pipelineLoading}
        onClose={() => setSelectedRunId(null)}
        onWorkflowUpdated={() => {
          void load()
          if (selectedRunId && data) {
            void fetchWorkflowPipelineDetail(selectedRunId, allRuns, data.runMetadata).then(
              setPipelineDetail,
            )
          }
        }}
      />

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b52a00]">
          {error}
        </div>
      ) : null}

      {/* Workflow Pipeline (kanban) */}
      <section className="flex w-full min-w-0 flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col gap-3 border-b border-[#e5e7eb] px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Workflow Pipeline
            </h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              {loading ? 'Loading…' : `${activeCount} active tasks across ${STAGE_ORDER.length} stages`}
            </p>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-4 text-[#6a7282]">
              {pipelineHelperText}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_PILLS.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setCategoryFilter(pill.id)}
                className={[
                  'inline-flex cursor-pointer items-center rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors',
                  categoryFilter === pill.id
                    ? 'bg-[#101828] text-white'
                    : 'bg-[#f3f4f6] text-[#364153] hover:bg-[#e5e7eb]',
                ].join(' ')}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="overflow-x-auto overscroll-x-contain touch-pan-x [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible"
          aria-label="Workflow stages"
        >
          <div className="flex w-max snap-x snap-mandatory gap-4 p-4 lg:grid lg:w-full lg:snap-none lg:grid-cols-2 xl:grid-cols-4">
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex w-[min(85vw,320px)] shrink-0 snap-start flex-col rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] min-h-[min(60vh,560px)] lg:w-auto lg:min-w-0"
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[#0a0a0a]">
                      {column.label}
                    </span>
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#e5e7eb] px-1.5 text-[11px] font-medium tabular-nums text-[#364153]">
                      {column.cards.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChooserOpen(true)}
                    aria-label={`Add workflow to ${column.label}`}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-[10px] text-[#6a7282] transition-colors hover:bg-[#e5e7eb] hover:text-[#101828]"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-3 overflow-y-visible px-3 pb-3 lg:min-h-0 lg:overflow-y-auto">
                  {loading ? (
                    <p className="px-1 py-6 text-center text-[12px] text-[#6a7282]">Loading…</p>
                  ) : column.cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-[12px] text-[#9ca3af]">
                      {categoryFilter === 'maintenance' && column.id === 'in_progress'
                        ? 'No maintenance tasks in progress'
                        : 'No tasks in this stage'}
                    </p>
                  ) : (
                    column.cards.map((card) => (
                      <KanbanCardItem
                        key={card.id}
                        card={card}
                        highlighted={highlightRunId === card.id}
                        onSelect={setSelectedRunId}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
