import { useId, useState, type ReactNode } from 'react'
import type { WorkflowKanbanStageId } from '@/lib/adminWorkflowKanban'
import { WORKFLOW_STAGE_LABEL } from '@/lib/adminWorkflowKanban'

export type StageMoveConfirmKind = 'new_intake_withdraw' | 'complete' | 'reopen'

export type StageMoveConfirmRequest = {
  kind: StageMoveConfirmKind
  runId: string
  ticketId: string
  fromStage: WorkflowKanbanStageId
  toStage: WorkflowKanbanStageId
  vendorName: string | null
  /** Inspection visit rollup — copy refers to all open fail items. */
  visitGroup?: boolean
  openItemCount?: number
}

type Props = {
  request: StageMoveConfirmRequest | null
  busy: boolean
  onCancel: () => void
  onConfirm: (opts: {
    findVendorNow?: boolean
    notifyVendorAndTenant?: boolean
    note?: string
  }) => void
}

export function WorkflowStageMoveDialogs({
  request,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId()
  const noteId = useId()
  const notifyId = useId()
  const [note, setNote] = useState('')
  const [notifyVendorAndTenant, setNotifyVendorAndTenant] = useState(false)

  if (!request) return null

  const vendor = request.vendorName?.trim() || 'The vendor'
  const toLabel = WORKFLOW_STAGE_LABEL[request.toStage]
  const visit = Boolean(request.visitGroup)
  const openCount = Math.max(1, request.openItemCount ?? 1)
  const failItemsLabel =
    openCount === 1 ? 'open fail item' : `${openCount} open fail items`

  let title = 'Move this task?'
  let body: ReactNode = null
  let primary = 'Move'
  let onPrimary = () => onConfirm({})

  if (request.kind === 'new_intake_withdraw') {
    title = visit ? 'Move inspection visit back to New Intake?' : 'Move back to New Intake?'
    body = (
      <p className="text-[14px] leading-5 text-[#364153]">
        {visit
          ? `Assigned vendors will be told each open fail item is withdrawn (${failItemsLabel}). The tenant won't be texted.`
          : `${vendor} will be told the job is withdrawn. The tenant won't be texted.`}
      </p>
    )
    primary = 'Move and hold'
    onPrimary = () => onConfirm({ findVendorNow: false })
  } else if (request.kind === 'complete') {
    title = visit ? 'Mark inspection visit as Completed?' : 'Mark as Completed?'
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-5 text-[#364153]">
          {visit
            ? `All ${failItemsLabel} will be marked completed. The tenant will get the usual completion message for each.`
            : `The tenant will get the usual completion message${
                request.vendorName ? `. ${vendor} stays on the work order.` : '.'
              }`}
        </p>
        <label htmlFor={noteId} className="text-[13px] font-medium text-[#0a0a0a]">
          Completion note (optional)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-[8px] border border-[#e5e7eb] px-3 py-2 text-[14px] text-[#0a0a0a]"
          placeholder="Anything the team should remember…"
        />
      </div>
    )
    primary = 'Mark completed'
    onPrimary = () => onConfirm({ note: note.trim() || undefined })
  } else if (request.kind === 'reopen') {
    title = visit ? `Move inspection visit back to ${toLabel}?` : `Move back to ${toLabel}?`
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-5 text-[#364153]">
          {visit
            ? `This reopens every fail item on the visit as ${toLabel}.`
            : `This reopens the work order as ${toLabel}.`}
        </p>
        <label className="flex items-start gap-2 text-[14px] text-[#364153]">
          <input
            id={notifyId}
            type="checkbox"
            checked={notifyVendorAndTenant}
            onChange={(e) => setNotifyVendorAndTenant(e.target.checked)}
            className="mt-1"
          />
          <span>Notify vendor and tenant</span>
        </label>
      </div>
    )
    primary = 'Reopen'
    onPrimary = () => onConfirm({ notifyVendorAndTenant })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-md rounded-[12px] bg-white p-5 shadow-lg">
        <h2 id={titleId} className="text-[18px] font-semibold text-[#0a0a0a]">
          {title}
        </h2>
        <div className="mt-3">{body}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-[8px] px-3 py-2 text-[14px] font-medium text-[#364153] hover:bg-[#f3f4f6]"
          >
            Cancel
          </button>
          {request.kind === 'new_intake_withdraw' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm({ findVendorNow: true })}
              className="rounded-[8px] bg-[#0030b5] px-3 py-2 text-[14px] font-medium text-white hover:bg-[#002690] disabled:opacity-60"
            >
              Find a new vendor now
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onPrimary}
            className="rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[14px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb] disabled:opacity-60"
          >
            {busy ? 'Moving…' : primary}
          </button>
        </div>
      </div>
    </div>
  )
}
