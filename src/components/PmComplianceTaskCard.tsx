import { useState } from 'react'
import {
  completePmTask,
  pmTaskKindUsesApplianceIcon,
  pmTaskKindUsesInspectionIcon,
  pmTaskKindUsesServiceIcon,
  updatePmAssetInstallYear,
  type PmComplianceTask,
} from '@/lib/pmCompliance'
import { buildPmTaskCardCopy } from '@shared/pm/taskCard'
import { getErrorMessage } from '@/lib/errorMessage'
import applianceRepairIcon from '@/assets/appliance-repair.png'
import inspectionReviewIcon from '@/assets/inspection-review.png'
import pmServiceIcon from '@/assets/pm-service.png'

type PmComplianceTaskCardProps = {
  task: PmComplianceTask
  index?: number
  onChanged?: () => void | Promise<void>
}

export function PmComplianceTaskCard({
  task,
  index = 0,
  onChanged,
}: PmComplianceTaskCardProps) {
  const copy = buildPmTaskCardCopy(task)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [busy, setBusy] = useState<'complete' | 'year' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installYear, setInstallYear] = useState('')

  const taskIcon = pmTaskKindUsesApplianceIcon(task.kind)
    ? applianceRepairIcon
    : pmTaskKindUsesInspectionIcon(task.kind)
      ? inspectionReviewIcon
      : pmTaskKindUsesServiceIcon(task.kind)
        ? pmServiceIcon
        : null

  const statusColor =
    copy.statusDot === 'red'
      ? 'text-[#c10007]'
      : copy.statusDot === 'amber'
        ? 'text-[#c2410c]'
        : 'text-[#008236]'
  const dueColor =
    copy.dueTone === 'danger'
      ? 'text-[#c10007] font-medium'
      : copy.dueTone === 'warning'
        ? 'text-[#c2410c] font-medium'
        : 'text-[#6a7282]'
  const recDot = copy.statusDot === 'green' ? '🟢' : copy.statusDot === 'red' ? '🔴' : '🟡'

  async function handleComplete() {
    setBusy('complete')
    setError(null)
    try {
      await completePmTask(task.id)
      await onChanged?.()
    } catch (err) {
      setError(getErrorMessage(err, 'That task could not be marked complete.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleInstallYear() {
    if (!task.unitAssetId) return
    const year = Number(installYear)
    setBusy('year')
    setError(null)
    try {
      await updatePmAssetInstallYear({ unitAssetId: task.unitAssetId, installYear: year })
      setInstallYear('')
      await onChanged?.()
    } catch (err) {
      setError(getErrorMessage(err, 'That installation year could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <article
      className="sa-enter border-b border-[#f3f4f6] py-4 first:pt-0 last:border-b-0 last:pb-0"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="flex min-w-0 gap-3">
        {taskIcon ? (
          <img src={taskIcon} alt="" className="mt-0.5 size-8 shrink-0 object-contain" aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#94a3b8]">
            {copy.eyebrow}
          </p>
          <h4 className="mt-0.5 text-[15px] font-semibold leading-5 text-[#0a0a0a]">{copy.title}</h4>
          <p className="mt-0.5 text-[12px] text-[#6a7282]">{copy.location}</p>
          <p className="mt-2 text-[12px] leading-5">
            <span className={statusColor}>
              {copy.statusDot === 'green' ? '🟢 ' : copy.statusDot === 'red' ? '🔴 ' : '🟡 '}
              {copy.statusLabel}
            </span>
            <span className="text-[#94a3b8]"> · </span>
            <span className={dueColor}>{copy.dueHeadline}</span>
          </p>
          <p className="mt-2 text-[13px] leading-5 text-[#374151]">{copy.summary}</p>

          {detailsOpen ? (
            <div className="mt-3 space-y-3 rounded-[10px] border border-[#e5e7eb] bg-[#f8fafc] px-3 py-3">
              <p className="text-[13px] leading-5 text-[#374151]">{copy.instruction}</p>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                  Asset details
                </p>
                <dl className="mt-1 space-y-0.5 text-[12px] leading-5 text-[#4b5563]">
                  <div>
                    <dt className="inline font-medium text-[#0a0a0a]">Age: </dt>
                    <dd className="inline">{copy.ageLabel}</dd>
                  </div>
                  {copy.lifespanLabel ? (
                    <div>
                      <dt className="inline font-medium text-[#0a0a0a]">Typical lifespan: </dt>
                      <dd className="inline">{copy.lifespanLabel}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline font-medium text-[#0a0a0a]">Condition: </dt>
                    <dd className="inline">{copy.conditionLabel}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-[#0a0a0a]">Failure risk: </dt>
                    <dd className="inline">{copy.failureRiskLabel}</dd>
                  </div>
                </dl>
                {copy.askInstallYear && task.unitAssetId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`pm-year-${task.id}`}>
                      Installation year
                    </label>
                    <input
                      id={`pm-year-${task.id}`}
                      inputMode="numeric"
                      placeholder="Add installation year"
                      value={installYear}
                      onChange={(e) => setInstallYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="h-8 w-[11rem] rounded-[8px] border border-[#e5e7eb] bg-white px-2 text-[12px] text-[#0a0a0a] outline-none focus:border-[#186179]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleInstallYear()}
                      disabled={busy != null || installYear.length !== 4}
                      className="sa-press h-8 rounded-[8px] border border-[#186179] bg-white px-3 text-[12px] font-medium text-[#186179] disabled:opacity-50"
                    >
                      {busy === 'year' ? 'Saving…' : 'Save year'}
                    </button>
                  </div>
                ) : null}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                  Ulo recommendation
                </p>
                <p className="mt-1 text-[13px] font-medium text-[#0a0a0a]">
                  {recDot} {copy.recommendationTitle}
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-[#4b5563]">{copy.recommendationBody}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                  Why this is recommended
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[#4b5563]">{copy.why}</p>
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-2 text-[12px] text-[#b91c1c]">{error}</p> : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="sa-press inline-flex h-8 items-center rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[12px] font-medium text-[#0a0a0a] hover:bg-[#f8fafc]"
            >
              {detailsOpen ? 'Hide details' : 'View details'}
            </button>
            {task.status !== 'completed' ? (
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={busy != null}
                className="sa-press inline-flex h-8 items-center rounded-[8px] border border-[#186179] bg-white px-3 text-[12px] font-medium text-[#186179] hover:bg-[#e8f2f5] disabled:opacity-50"
              >
                {busy === 'complete' ? 'Saving…' : 'Mark complete'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
