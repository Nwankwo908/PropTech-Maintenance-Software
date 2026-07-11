import { useNavigate } from 'react-router-dom'
import type { PropertyWorkflowRow } from '@/lib/propertyWorkflowRows'
import {
  WORKFLOW_PIPELINE_MAINTENANCE_FILTER_HELPER,
  workflowOperationsPath,
} from '@/lib/adminWorkflowKanban'

type PropertyWorkflowsListProps = {
  rows: PropertyWorkflowRow[]
  loading?: boolean
}

/** Property detail — Workflows tab list (Figma property overview). */
export function PropertyWorkflowsList({ rows, loading = false }: PropertyWorkflowsListProps) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="mt-6 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">Loading active tasks…</p>
      </div>
    )
  }

  return (
    <div className="mt-6 w-full">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-[13px] leading-5 text-[#6a7282]">
          {WORKFLOW_PIPELINE_MAINTENANCE_FILTER_HELPER} Other property tasks appear under Active Tasks
          too — rent, inspections, move-ins, and more.
        </p>
        <button
          type="button"
          onClick={() => navigate('/admin/workflows')}
          className="shrink-0 text-[13px] font-medium text-[#1447e6] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          Open workflow pipeline
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="w-full rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-center text-[13px] text-[#6a7282]">
            No active tasks for this property in the workflow pipeline.
          </p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="grid w-full grid-cols-[minmax(0,1fr)_120px_140px] items-center gap-4 border-b border-[#e5e7eb] bg-[#f9fafb] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span>Task</span>
            <span>Priority</span>
            <span className="text-right sm:text-left">Status</span>
          </div>
          <ul>
            {rows.map((row, index) => (
              <li key={row.id} className={index > 0 ? 'border-t border-[#f3f4f6]' : undefined}>
                <button
                  type="button"
                  onClick={() => navigate(workflowOperationsPath(row.id))}
                  className="grid w-full grid-cols-[minmax(0,1fr)_120px_140px] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{row.title}</p>
                    <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">{row.metaLine}</p>
                  </div>
                  <span
                    className={`inline-flex w-fit rounded-[4px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${row.priorityClassName}`}
                  >
                    {row.priorityLabel}
                  </span>
                  <span className="text-right text-[13px] leading-5 text-[#6a7282] sm:text-left">{row.statusLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
