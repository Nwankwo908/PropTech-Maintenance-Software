import { InspectionAssessmentTable } from './InspectionAssessmentTable'
import { useCallback, useEffect, useState } from 'react'
import { type HomeCheckList, homeCheckRequest } from '@/api/homeCheck'
import { supabase } from '@/lib/supabase'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import { HOME_CHECK_CHANGED_EVENT } from '@/lib/homeCheckEvents'
import {
  HOME_CHECK_MONTHS,
  homeCheckAssetPreview,
  homeCheckLabelCorrection,
  homeCheckLabelDraft,
  homeCheckReviewLabels,
  homeCheckReviewResult,
  type HomeCheckLabelDraft,
} from '@/lib/homeCheckReview'
import { formatHomeCheckLocation, homeCheckFollowUpExplanation } from '@shared/homeCheck'

type ListedHomeCheck = HomeCheckList['checks'][number] & {
  completed_at?: string | null
  confirmed_at?: string | null
  labels_readable?: boolean | null
  issue_ticket_id?: string | null
}

const PLATE_INPUT =
  'w-auto bg-transparent px-0 py-0.5 text-[13px] text-[#68717a] outline-none placeholder:text-[#94a3b8]'

function ManufactureDateFields(
  { draft, onChange }: { draft: HomeCheckLabelDraft; onChange: (next: HomeCheckLabelDraft) => void },
) {
  return (
    <div className='mt-1 space-y-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <select
          aria-label='Manufacture month'
          value={draft.manufactureMonth}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ ...draft, manufactureMonth: event.target.value })}
          className={PLATE_INPUT}
        >
          <option value=''>Month unknown</option>
          {HOME_CHECK_MONTHS.map((name, index) => (
            <option key={name} value={String(index + 1)}>{name}</option>
          ))}
        </select>
        <input
          aria-label='Manufacture year'
          inputMode='numeric'
          placeholder='Year'
          value={draft.manufactureYear}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ ...draft, manufactureYear: event.target.value })}
          className={`${PLATE_INPUT} w-16`}
        />
      </div>
      <p className='text-[12px] leading-4 text-[#64748b]'>
        Age is calculated from the month and year on the plate. Leave either one blank when it is not readable.
      </p>
    </div>
  )
}

export function HomeCheckPanel(
  { building, propertyId }: { building: string; propertyId?: string | null },
) {
  const [list, setList] = useState<HomeCheckList | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [labelEdits, setLabelEdits] = useState<Record<string, HomeCheckLabelDraft>>({})
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const refresh = useCallback(async () => {
    if (!propertyId || !supabase) return
    const result = await homeCheckRequest<HomeCheckList>({ action: 'list', propertyId })
    setList(result)
  }, [propertyId])
  useEffect(() => {
    let cancelled = false
    const update = () => {
      void refresh().catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Home Checks.')
      })
    }
    update()
    const timer = window.setInterval(update, 15000)
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ propertyId?: string }>).detail
      if (detail?.propertyId && detail.propertyId !== propertyId) return
      update()
    }
    window.addEventListener(HOME_CHECK_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener(HOME_CHECK_CHANGED_EVENT, onChanged)
    }
  }, [propertyId, refresh])
  async function confirm(id: string) {
    setBusy(true)
    setError('')
    try {
      const record = list?.checks.find((check) => check.id === id)
      const labelCorrections = record?.assets.filter((asset) =>
        labelEdits[asset.id]
      ).map((asset) => homeCheckLabelCorrection(asset.id, labelEdits[asset.id])) || []
      await homeCheckRequest({ action: 'confirm', id, labelCorrections })
      await refresh()
      notifyAssetRegistryChanged(building)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm Home Check.')
    } finally {
      setBusy(false)
    }
  }
  if (!list?.checks.length) {
    return error ? <p role='alert' className='text-sm text-red-700'>{error}</p> : null
  }
  return (
    <div className='space-y-4'>
      {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
      {list.checks.map((check) => {
        const record = check as ListedHomeCheck
        const canReview = Boolean(record.completed_at && !record.confirmed_at && record.assets.length)
        const selectedHere = record.assets.filter((asset) =>
          selectedAssetIds.includes(asset.id) && !asset.verified
        )
        const confirmBlocked = busy || record.assets.length !== 2 || record.photos.some((photo) =>
          photo.state === 'queued' || photo.state === 'analyzing'
        ) || record.assets.some((asset) =>
          asset.labelReadability?.retakeRequested && !labelEdits[asset.id]
        )
        return (
          <section key={record.id} aria-label={`${record.reference} results`}>
            <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
              <div>
                <p className='text-[13px] font-semibold text-[#334155]'>Assets from Home Check</p>
                <p className='text-[12px] text-[#64748b]'>
                  {formatHomeCheckLocation(record.property_label, record.unit_label)} · {record.reference}
                  {record.labels_readable ? ' · Labels readable' : record.assets.length
                    ? ' · Label details need review'
                    : ` · ${record.status}`}
                </p>
              </div>
              {canReview && (
                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    disabled={selectedHere.length === 0 || busy}
                    onClick={() => {
                      setLabelEdits((previous) => {
                        const next = { ...previous }
                        for (const asset of selectedHere) {
                          if (!next[asset.id]) next[asset.id] = homeCheckLabelDraft(asset)
                        }
                        return next
                      })
                    }}
                    className='rounded-[10px] border border-[#cbd5e1] bg-white px-4 py-2 text-[13px] font-semibold text-[#334155] disabled:opacity-40'
                  >
                    Edit selected{selectedHere.length ? ` (${selectedHere.length})` : ''}
                  </button>
                  <button
                    type='button'
                    disabled={confirmBlocked}
                    onClick={() => void confirm(record.id)}
                    className='rounded-[10px] bg-[#186179] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40'
                  >
                    Confirm asset records
                  </button>
                </div>
              )}
            </div>
            {record.assets.length > 0 && (
              <InspectionAssessmentTable
                rows={record.assets.map((asset) => {
                  const draft = !asset.verified ? labelEdits[asset.id] : undefined
                  const labels = homeCheckReviewLabels(asset)
                  const result = homeCheckReviewResult(asset, draft)
                  return {
                    id: asset.id,
                    previewUrl: homeCheckAssetPreview(asset.system, record.photos),
                    editable: Boolean(draft),
                    labelFieldsOnly: true,
                    categoryLabel: labels.categoryLabel,
                    conditionLabel: labels.conditionLabel,
                    actionLabel: labels.actionLabel,
                    result: labels.actionLabel === 'Details verified'
                      ? { ...result, labelReadability: undefined }
                      : result,
                    descriptionExtra: draft
                      ? (
                        <ManufactureDateFields
                          draft={draft}
                          onChange={(next) =>
                            setLabelEdits((previous) => ({ ...previous, [asset.id]: next }))}
                        />
                      )
                      : (
                        <p className='mt-1 text-[12px] leading-4 text-[#64748b]'>
                          {labels.manufactureLabel}
                        </p>
                      ),
                  }
                })}
                checkedIds={canReview ? selectedAssetIds : undefined}
                onCheckedIdsChange={canReview ? setSelectedAssetIds : undefined}
                onChangeRow={(id, result) => {
                  setLabelEdits((previous) => {
                    const current = previous[id]
                    if (!current) return previous
                    return {
                      ...previous,
                      [id]: {
                        ...current,
                        modelNumber: result.identifiedItem.modelNumber ?? '',
                        serialNumber: result.identifiedItem.serialNumber ?? '',
                      },
                    }
                  })
                }}
              />
            )}
            {record.issue_ticket_id && (
              <p className='mt-3 text-sm text-[#92400e]'>
                {homeCheckFollowUpExplanation({
                  warningSigns: record.answers?.warningSigns,
                  warningDetails: record.answers?.warningDetails,
                  detectedWarning: record.detected_warning,
                })}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
