import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  formatCurrency,
  formatEventLabel,
  formatLocationContextLabel,
  formatRentClassificationLabel,
  formatRentDueDate,
  formatStepLabel,
  formatWorkflowTimestamp,
  type AdminLifecycleDashboard,
  type AdminLifecycleRow,
  type AdminRentCollectionDashboard,
  type AdminRentCollectionRow,
  type AdminWorkflowGroupCard,
  type AdminWorkflowRow,
  type WorkflowTemplateGroupId,
} from '@/lib/adminWorkflows'
import {
  loadResidentsForTimelinePicker,
  type TimelineResidentOption,
} from '@/lib/propertyOperationsGraph'
import { PropertyOperationsTimeline } from '@/components/PropertyOperationsTimeline'
import { supabase } from '@/lib/supabase'

type RentFilter = 'all' | 'due_today' | 'overdue' | 'reminder_sent'
type HistoryScopeMode = 'unit' | 'resident'

const GROUP_ACCENT: Record<
  WorkflowTemplateGroupId,
  { ring: string; statActive: string; statOverdue: string }
> = {
  maintenance: {
    ring: 'ring-[#0030b5]',
    statActive: 'text-[#0030b5]',
    statOverdue: 'text-[#b52a00]',
  },
  rent_collection: {
    ring: 'ring-[#92600a]',
    statActive: 'text-[#0030b5]',
    statOverdue: 'text-[#b52a00]',
  },
  move_in: {
    ring: 'ring-[#0030b5]',
    statActive: 'text-[#0030b5]',
    statOverdue: 'text-[#b52a00]',
  },
  move_out: {
    ring: 'ring-[#b52a00]',
    statActive: 'text-[#0030b5]',
    statOverdue: 'text-[#b52a00]',
  },
  inspection: {
    ring: 'ring-[#4a2d8a]',
    statActive: 'text-[#4a2d8a]',
    statOverdue: 'text-[#b52a00]',
  },
}

function WorkflowGroupCard({
  card,
  selected,
  onSelect,
}: {
  card: AdminWorkflowGroupCard
  selected: boolean
  onSelect: () => void
}) {
  const accent = GROUP_ACCENT[card.id]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex h-full w-full cursor-pointer flex-col rounded-[10px] border border-secondary bg-white p-5 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-md',
        selected ? `ring-2 ring-inset ${accent.ring}` : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-extended-3">{card.title}</h3>
        <span className="shrink-0 text-[12px] tabular-nums text-neutral">
          {card.runCount} run{card.runCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.04em] text-neutral">Active</p>
          <p className={`mt-1 text-[24px] font-light tabular-nums leading-none ${accent.statActive}`}>
            {card.activeCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.04em] text-neutral">Overdue</p>
          <p className={`mt-1 text-[24px] font-light tabular-nums leading-none ${accent.statOverdue}`}>
            {card.overdueCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.04em] text-neutral">Completed</p>
          <p className="mt-1 text-[24px] font-light tabular-nums leading-none text-extended-3">
            {card.completedCount}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-secondary pt-4">
        <p className="text-[11px] uppercase tracking-[0.04em] text-neutral">Latest event</p>
        <p className="mt-1 line-clamp-2 text-[13px] font-medium text-extended-3">
          {card.latestEvent.label}
        </p>
        <p className="mt-0.5 text-[12px] text-neutral">
          {formatWorkflowTimestamp(card.latestEvent.at)}
        </p>
      </div>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-[0.04em] text-neutral">Context</p>
        <p className="mt-1 line-clamp-2 text-[13px] text-extended-3">
          {formatLocationContextLabel(card.context)}
        </p>
      </div>
    </button>
  )
}

function StatusBadge({ status }: { status: AdminWorkflowRow['status'] }) {
  const styles: Record<AdminWorkflowRow['status'], string> = {
    active: 'bg-[#e8f4ff] text-[#0030b5]',
    escalated: 'bg-[#fff1e8] text-[#b52a00]',
    completed: 'bg-secondary text-neutral-variant',
    cancelled: 'bg-secondary text-neutral',
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function ClassificationBadge({ row }: { row: AdminRentCollectionRow }) {
  if (row.isOverdue || row.status === 'escalated') {
    return (
      <span className="inline-flex rounded-full bg-[#fff1e8] px-2.5 py-0.5 text-[12px] font-medium text-[#b52a00]">
        Overdue
      </span>
    )
  }
  if (row.isDueToday) {
    return (
      <span className="inline-flex rounded-full bg-[#fff8e6] px-2.5 py-0.5 text-[12px] font-medium text-[#92600a]">
        Due today
      </span>
    )
  }
  if (row.rentClassification) {
    return (
      <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-medium text-neutral-variant">
        {formatRentClassificationLabel(row.rentClassification)}
      </span>
    )
  }
  return <span className="text-[14px] text-neutral">—</span>
}

function ReminderSentCell({ row }: { row: AdminRentCollectionRow }) {
  if (!row.reminderSent) {
    return <span className="text-[14px] text-neutral">Not sent</span>
  }

  const channels: string[] = []
  if (row.reminderSmsSent) channels.push('SMS')
  if (row.reminderEmailSent) channels.push('Email')

  return (
    <div>
      <p className="text-[14px] font-medium text-extended-3">Sent</p>
      <p className="mt-0.5 text-[12px] text-neutral">
        {channels.length ? channels.join(' · ') : 'Reminder logged'}
      </p>
    </div>
  )
}

function LocationCell({ row }: { row: AdminWorkflowRow }) {
  const parts = [row.propertyLabel, row.unitLabel].filter(Boolean)
  const location = parts.length ? parts.join(' · ') : '—'

  return (
    <div className="min-w-0">
      <p className="truncate text-[14px] text-extended-3">{location}</p>
      {row.residentName ? (
        <p className="truncate text-[12px] text-neutral">{row.residentName}</p>
      ) : row.residentId ? (
        <p className="truncate text-[12px] text-neutral">Resident {row.residentId.slice(0, 8)}…</p>
      ) : null}
    </div>
  )
}

function WorkflowTimeline({ events }: { events: AdminRentCollectionRow['timeline'] }) {
  if (!events.length) {
    return (
      <p className="text-[13px] text-neutral">No workflow events recorded yet.</p>
    )
  }

  return (
    <ol className="relative space-y-0 border-l border-secondary pl-4">
      {events.map((event, index) => (
        <li key={event.id} className="relative pb-4 last:pb-0">
          <span
            className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-[13px] font-medium text-extended-3">{event.label}</p>
              <p className="text-[12px] text-neutral">
                {formatWorkflowTimestamp(event.createdAt)}
              </p>
            </div>
            {event.message ? (
              <p className="mt-0.5 text-[12px] leading-4 text-neutral">{event.message}</p>
            ) : null}
            {index === events.length - 1 ? (
              <p className="mt-1 text-[11px] uppercase tracking-[0.04em] text-neutral">Latest</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RentCollectionTable({
  rows,
  emptyMessage,
  showTimeline = true,
}: {
  rows: AdminRentCollectionRow[]
  emptyMessage: string
  showTimeline?: boolean
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  if (!rows.length) {
    return (
      <p className="px-6 py-10 text-center text-[14px] text-neutral">{emptyMessage}</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-secondary bg-[#fafafa]">
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Resident / unit
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Amount
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Rent due
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Due today / overdue
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Reminder sent
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Payment status
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Status
            </th>
            {showTimeline ? (
              <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
                Timeline
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedRunId === row.id
            return (
              <Fragment key={row.id}>
                <tr className="border-b border-secondary">
                  <td className="px-4 py-3 align-top">
                    <LocationCell row={row} />
                    {row.billingPeriod ? (
                      <p className="mt-1 text-[11px] text-neutral">Period {row.billingPeriod}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-[14px] tabular-nums text-extended-3">
                    {formatCurrency(row.amountDue)}
                  </td>
                  <td className="px-4 py-3 align-top text-[14px] text-extended-3">
                    {formatRentDueDate(row.rentDueDate)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ClassificationBadge row={row} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ReminderSentCell row={row} />
                  </td>
                  <td className="px-4 py-3 align-top text-[14px] text-extended-3">
                    {row.paymentStatus}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusBadge status={row.status} />
                    <p className="mt-1 text-[12px] text-neutral">
                      {formatStepLabel(row.currentStep)}
                    </p>
                  </td>
                  {showTimeline ? (
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => setExpandedRunId(expanded ? null : row.id)}
                        className="cursor-pointer text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {expanded ? 'Hide timeline' : `View (${row.timeline.length})`}
                      </button>
                    </td>
                  ) : null}
                </tr>
                {showTimeline && expanded ? (
                  <tr className="border-b border-secondary bg-[#fafafa]">
                    <td colSpan={8} className="px-4 py-4">
                      <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
                        Workflow timeline — {row.residentName ?? row.unitLabel ?? 'Resident'}
                      </p>
                      <WorkflowTimeline events={row.timeline} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WorkflowTable({
  rows,
  emptyMessage,
}: {
  rows: AdminWorkflowRow[]
  emptyMessage: string
}) {
  if (!rows.length) {
    return (
      <p className="px-6 py-10 text-center text-[14px] text-neutral">{emptyMessage}</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-secondary bg-[#fafafa]">
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Workflow
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Type
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Property / unit / resident
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Current step
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Status
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Last event
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-secondary last:border-b-0">
              <td className="px-4 py-3 align-top">
                <p className="text-[14px] font-medium text-extended-3">{row.templateName}</p>
                <p className="mt-0.5 font-mono text-[11px] text-neutral">{row.id.slice(0, 8)}…</p>
              </td>
              <td className="px-4 py-3 align-top">
                <span className="text-[14px] capitalize text-extended-3">{row.templateType}</span>
              </td>
              <td className="px-4 py-3 align-top">
                <LocationCell row={row} />
              </td>
              <td className="px-4 py-3 align-top text-[14px] text-extended-3">
                {formatStepLabel(row.currentStep)}
              </td>
              <td className="px-4 py-3 align-top">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 align-top">
                <p className="text-[14px] text-extended-3">{formatEventLabel(row)}</p>
                <p className="mt-0.5 text-[12px] text-neutral">
                  {formatWorkflowTimestamp(row.lastEventAt)}
                </p>
              </td>
              <td className="px-4 py-3 align-top text-[14px] text-neutral">
                {formatWorkflowTimestamp(row.startedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LifecycleTable({
  rows,
  emptyMessage,
  highlightRunId,
}: {
  rows: AdminLifecycleRow[]
  emptyMessage: string
  highlightRunId?: string | null
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  if (!rows.length) {
    return (
      <p className="px-6 py-10 text-center text-[14px] text-neutral">{emptyMessage}</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-secondary bg-[#fafafa]">
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Workflow
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Resident / unit
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Classification
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Key date
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Status
            </th>
            <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
              Timeline
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedRunId === row.id
            const highlighted = highlightRunId === row.id
            const keyDate =
              row.templateId === 'move_in'
                ? formatRentDueDate(row.moveInDate)
                : row.templateId === 'move_out'
                  ? formatRentDueDate(row.moveOutDate)
                  : formatWorkflowTimestamp(row.scheduledAt)

            return (
              <Fragment key={row.id}>
                <tr
                  id={`workflow-run-${row.id}`}
                  className={[
                    'border-b border-secondary',
                    highlighted ? 'bg-[#fffde8] ring-2 ring-inset ring-[#ffee6c]' : '',
                  ].join(' ')}
                >
                  <td className="px-4 py-3 align-top">
                    <p className="text-[14px] font-medium text-extended-3">{row.templateName}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-neutral">{row.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <LocationCell row={row} />
                  </td>
                  <td className="px-4 py-3 align-top text-[14px] text-extended-3">
                    {row.lifecycleClassification?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td className="px-4 py-3 align-top text-[14px] text-extended-3">{keyDate}</td>
                  <td className="px-4 py-3 align-top">
                    <StatusBadge status={row.status} />
                    <p className="mt-1 text-[12px] text-neutral">
                      {formatStepLabel(row.currentStep)}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(expanded ? null : row.id)}
                      className="cursor-pointer text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {expanded ? 'Hide timeline' : `View (${row.timeline.length})`}
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="border-b border-secondary bg-[#fafafa]">
                    <td colSpan={6} className="px-4 py-4">
                      <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral">
                        Workflow timeline — {row.residentName ?? row.unitLabel ?? 'Unit'}
                      </p>
                      <WorkflowTimeline events={row.timeline} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

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
              className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-secondary px-4 text-[14px] font-medium text-extended-3 hover:bg-secondary disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !unitId}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Starting…' : 'Start workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RentFilterTabs({
  filter,
  onChange,
  rent,
}: {
  filter: RentFilter
  onChange: (filter: RentFilter) => void
  rent: AdminRentCollectionDashboard
}) {
  const tabs: Array<{ id: RentFilter; label: string; count: number }> = [
    { id: 'all', label: 'All runs', count: rent.runs.length },
    { id: 'due_today', label: 'Due today', count: rent.stats.dueTodayCount },
    { id: 'overdue', label: 'Overdue', count: rent.stats.overdueCount },
    { id: 'reminder_sent', label: 'Reminder sent', count: rent.stats.reminderSentCount },
  ]

  return (
    <div className="flex flex-wrap gap-2 border-b border-secondary px-6 py-3">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={[
            'inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
            filter === tab.id
              ? 'bg-[#ffee6c] text-[#92600a]'
              : 'bg-secondary text-neutral-variant hover:bg-[#ececec]',
          ].join(' ')}
        >
          {tab.label}
          <span className="tabular-nums text-[12px] opacity-80">{tab.count}</span>
        </button>
      ))}
    </div>
  )
}

export function AdminWorkflowOperationsDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [maintenanceRuns, setMaintenanceRuns] = useState<AdminWorkflowRow[]>([])
  const [groups, setGroups] = useState<AdminWorkflowGroupCard[]>([])
  const [selectedGroup, setSelectedGroup] = useState<WorkflowTemplateGroupId>('maintenance')
  const [rentCollection, setRentCollection] = useState<AdminRentCollectionDashboard>({
    runs: [],
    dueToday: [],
    overdue: [],
    reminderSent: [],
    escalatedResidents: [],
    stats: {
      dueTodayCount: 0,
      overdueCount: 0,
      reminderSentCount: 0,
      escalatedCount: 0,
    },
  })
  const [rentFilter, setRentFilter] = useState<RentFilter>('all')
  const [lifecycle, setLifecycle] = useState<AdminLifecycleDashboard>({
    runs: [],
    moveIn: [],
    moveOut: [],
    inspections: [],
    stats: {
      moveInCount: 0,
      moveOutCount: 0,
      inspectionCount: 0,
      activeCount: 0,
    },
  })
  const [startModalWorkflow, setStartModalWorkflow] = useState<LifecycleWorkflowType | null>(
    null,
  )
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null)
  const [historyScopeMode, setHistoryScopeMode] = useState<HistoryScopeMode>('unit')
  const [historyUnitId, setHistoryUnitId] = useState('')
  const [historyResidentId, setHistoryResidentId] = useState('')
  const [historyUnits, setHistoryUnits] = useState<UnitOption[]>([])
  const [historyResidents, setHistoryResidents] = useState<TimelineResidentOption[]>([])
  const [historyPickerLoading, setHistoryPickerLoading] = useState(false)

  const historyScope = useMemo(() => {
    if (historyScopeMode === 'unit' && historyUnitId.trim()) {
      return { unitId: historyUnitId.trim() } as const
    }
    if (historyScopeMode === 'resident' && historyResidentId.trim()) {
      return { residentId: historyResidentId.trim() } as const
    }
    return null
  }, [historyScopeMode, historyUnitId, historyResidentId])

  const selectedGroupCard = useMemo(
    () => groups.find((group) => group.id === selectedGroup) ?? null,
    [groups, selectedGroup],
  )

  const filteredRentRows = useMemo(() => {
    switch (rentFilter) {
      case 'due_today':
        return rentCollection.dueToday
      case 'overdue':
        return rentCollection.overdue
      case 'reminder_sent':
        return rentCollection.reminderSent
      default:
        return rentCollection.runs
    }
  }, [rentCollection, rentFilter])

  const selectedLifecycleRows = useMemo(() => {
    switch (selectedGroup) {
      case 'move_in':
        return lifecycle.moveIn
      case 'move_out':
        return lifecycle.moveOut
      case 'inspection':
        return lifecycle.inspections
      default:
        return []
    }
  }, [lifecycle, selectedGroup])

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await fetchAdminWorkflowDashboard()
      setMaintenanceRuns(data.maintenanceRuns)
      setGroups(data.groups)
      setRentCollection(data.rentCollection)
      setLifecycle(data.lifecycle)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleWorkflowStarted = useCallback(
    (workflowRunId: string, workflow: LifecycleWorkflowType) => {
      setSelectedGroup(workflow)
      setHighlightRunId(workflowRunId)
      void load()
      window.setTimeout(() => {
        document
          .getElementById(`workflow-run-${workflowRunId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 400)
      window.setTimeout(() => setHighlightRunId(null), 8000)
    },
    [load],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setHistoryPickerLoading(true)
    void Promise.all([loadUnitsForWorkflowPicker(), loadResidentsForTimelinePicker()])
      .then(([units, residents]) => {
        setHistoryUnits(units)
        setHistoryResidents(residents)
      })
      .finally(() => setHistoryPickerLoading(false))
  }, [])

  useEffect(() => {
    if (!supabase) return

    const channel = supabase
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
      void supabase.removeChannel(channel)
    }
  }, [load])

  return (
    <>
      <header className="border-b border-secondary bg-white px-8 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-primary">
              Operations layer
            </p>
            <h1 className="mt-1 text-[22px] font-semibold leading-8 tracking-[0.0703px] text-extended-3 sm:text-[24px]">
              Workflows
            </h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-5 tracking-[-0.1504px] text-neutral">
              Rent collection, move-in, move-out, inspection, lease renewal, and maintenance
              intake workflows. Maintenance tickets remain in{' '}
              <Link to="/admin/requests" className="font-medium text-primary underline-offset-2 hover:underline">
                Request Management
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStartModalWorkflow('move_in')}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-black/10 bg-[#e8f4ff] px-4 text-[14px] font-medium text-[#0030b5] outline-none transition-colors hover:bg-[#d6ebff]"
            >
              Start move in
            </button>
            <button
              type="button"
              onClick={() => setStartModalWorkflow('move_out')}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-black/10 bg-[#fff1e8] px-4 text-[14px] font-medium text-[#b52a00] outline-none transition-colors hover:bg-[#ffe4d4]"
            >
              Start move out
            </button>
            <button
              type="button"
              onClick={() => setStartModalWorkflow('inspection')}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-black/10 bg-[#f3eeff] px-4 text-[14px] font-medium text-[#4a2d8a] outline-none transition-colors hover:bg-[#e8deff]"
            >
              Start inspection
            </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-[14px] font-medium text-extended-3 outline-none transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          </div>
        </div>
      </header>

      <StartLifecycleWorkflowModal
        open={startModalWorkflow != null}
        workflow={startModalWorkflow ?? 'move_in'}
        onClose={() => setStartModalWorkflow(null)}
        onStarted={(workflowRunId) => {
          if (startModalWorkflow) {
            handleWorkflowStarted(workflowRunId, startModalWorkflow)
          }
        }}
      />

      <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
        <div className="w-full space-y-6">
          {error ? (
            <div className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b52a00]">
              {error}
            </div>
          ) : null}

          <section>
            <div className="mb-4">
              <h2 className="text-[16px] font-semibold text-extended-3">Workflow overview</h2>
              <p className="mt-1 text-[13px] text-neutral">
                Grouped by template type. Select a card to view runs and timelines.
              </p>
            </div>

            {loading && !groups.length ? (
              <p className="rounded-[10px] border border-secondary bg-white px-6 py-10 text-center text-[14px] text-neutral">
                Loading workflow groups…
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {groups.map((card) => (
                  <WorkflowGroupCard
                    key={card.id}
                    card={card}
                    selected={selectedGroup === card.id}
                    onSelect={() => setSelectedGroup(card.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[10px] border border-secondary bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex flex-col gap-3 border-b border-secondary px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-extended-3">
                  {selectedGroupCard?.title ?? 'Workflow runs'}
                </h2>
                <p className="mt-1 text-[13px] text-neutral">
                  {selectedGroup === 'maintenance'
                    ? 'Maintenance intake and request workflows.'
                    : selectedGroup === 'rent_collection'
                      ? 'Due dates, reminders, payment status, and per-resident timelines.'
                      : selectedGroup === 'move_in'
                        ? 'Move-in lifecycle runs with graph events.'
                        : selectedGroup === 'move_out'
                          ? 'Move-out lifecycle runs with graph events.'
                          : 'Inspection lifecycle runs with graph events.'}
                </p>
              </div>
              {selectedGroup === 'move_in' ? (
                <button
                  type="button"
                  onClick={() => setStartModalWorkflow('move_in')}
                  className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-secondary px-3 text-[13px] font-medium text-extended-3 hover:bg-secondary"
                >
                  + Start move in
                </button>
              ) : null}
              {selectedGroup === 'move_out' ? (
                <button
                  type="button"
                  onClick={() => setStartModalWorkflow('move_out')}
                  className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-secondary px-3 text-[13px] font-medium text-extended-3 hover:bg-secondary"
                >
                  + Start move out
                </button>
              ) : null}
              {selectedGroup === 'inspection' ? (
                <button
                  type="button"
                  onClick={() => setStartModalWorkflow('inspection')}
                  className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-secondary px-3 text-[13px] font-medium text-extended-3 hover:bg-secondary"
                >
                  + Start inspection
                </button>
              ) : null}
            </div>

            {selectedGroup === 'rent_collection' ? (
              <RentFilterTabs
                filter={rentFilter}
                onChange={setRentFilter}
                rent={rentCollection}
              />
            ) : null}

            {loading ? (
              <p className="px-6 py-10 text-center text-[14px] text-neutral">Loading runs…</p>
            ) : selectedGroup === 'maintenance' ? (
              <WorkflowTable
                rows={maintenanceRuns}
                emptyMessage="No maintenance workflow runs yet."
              />
            ) : selectedGroup === 'rent_collection' ? (
              <>
                <RentCollectionTable
                  rows={filteredRentRows}
                  emptyMessage="No rent collection runs match this filter."
                />
                {rentCollection.escalatedResidents.length ? (
                  <div className="border-t border-[#fecaca] bg-[#fffafa]">
                    <div className="border-b border-secondary px-6 py-4">
                      <h3 className="text-[14px] font-semibold text-[#b52a00]">
                        Escalated residents
                      </h3>
                      <p className="mt-1 text-[13px] text-neutral">
                        Late payment escalations — unpaid after due date and grace period.
                      </p>
                    </div>
                    <RentCollectionTable
                      rows={rentCollection.escalatedResidents}
                      emptyMessage="No escalated rent collection runs."
                      showTimeline
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <LifecycleTable
                rows={selectedLifecycleRows}
                emptyMessage={`No ${selectedGroupCard?.title.toLowerCase() ?? 'lifecycle'} runs yet.`}
                highlightRunId={highlightRunId}
              />
            )}
          </section>

          <section className="rounded-[10px] border border-secondary bg-white px-6 py-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="mb-4 flex flex-col gap-3 border-b border-secondary pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-extended-3">Connected history</h2>
                <p className="mt-1 text-[13px] text-neutral">
                  Unified timeline from the property operations graph for a unit or resident.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setHistoryScopeMode('unit')}
                  className={[
                    'inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-[13px] font-medium',
                    historyScopeMode === 'unit'
                      ? 'bg-[#e8f4ff] text-[#0030b5]'
                      : 'border border-secondary text-extended-3 hover:bg-secondary',
                  ].join(' ')}
                >
                  By unit
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryScopeMode('resident')}
                  className={[
                    'inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-[13px] font-medium',
                    historyScopeMode === 'resident'
                      ? 'bg-[#e8f4ff] text-[#0030b5]'
                      : 'border border-secondary text-extended-3 hover:bg-secondary',
                  ].join(' ')}
                >
                  By resident
                </button>
              </div>
            </div>

            <div className="mb-5 max-w-md">
              {historyScopeMode === 'unit' ? (
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-extended-3">Unit</span>
                  <select
                    value={historyUnitId}
                    onChange={(e) => setHistoryUnitId(e.target.value)}
                    disabled={historyPickerLoading}
                    className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
                  >
                    <option value="">
                      {historyPickerLoading ? 'Loading units…' : 'Select unit'}
                    </option>
                    {historyUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_label}
                        {unit.building ? ` · ${unit.building}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-extended-3">Resident</span>
                  <select
                    value={historyResidentId}
                    onChange={(e) => setHistoryResidentId(e.target.value)}
                    disabled={historyPickerLoading}
                    className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
                  >
                    <option value="">
                      {historyPickerLoading ? 'Loading residents…' : 'Select resident'}
                    </option>
                    {historyResidents.map((resident) => (
                      <option key={resident.id} value={resident.id}>
                        {resident.full_name}
                        {resident.unit ? ` · ${resident.unit}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <PropertyOperationsTimeline scope={historyScope} />
          </section>
        </div>
      </main>
    </>
  )
}
