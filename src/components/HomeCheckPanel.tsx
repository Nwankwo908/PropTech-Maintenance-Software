import { InspectionAssessmentTable, type InspectionAssessmentTableRow } from './InspectionAssessmentTable'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ApplianceVisionResult } from '@/lib/vision/types'
import { isUnmatchedApplianceRow } from '@/lib/inspectionAssessmentTable'
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
import { homeCheckFollowUpExplanation } from '@shared/homeCheck'

type ListedHomeCheck = HomeCheckList['checks'][number] & {
  completed_at?: string | null
  confirmed_at?: string | null
  labels_readable?: boolean | null
  issue_ticket_id?: string | null
}

function applianceFamily(row: InspectionAssessmentTableRow): string {
  const label = `${row.categoryLabel ?? ''} ${row.result?.identifiedItem.type ?? ''} ${row.result?.category ?? ''}`.toLowerCase()
  if (label.includes('water')) return 'water_heater'
  if (/heat|hvac|furnace|boiler/.test(label)) return 'heating'
  return label.trim()
}

function plateScore(row: InspectionAssessmentTableRow): number {
  const item = row.result?.identifiedItem
  const present = (value?: string) => {
    const text = value?.trim() ?? ''
    return Boolean(text) && text !== '-' && text.toLowerCase() !== 'unknown'
  }
  return (present(item?.brand) ? 2 : 0)
    + (present(item?.modelNumber) ? 2 : 0)
    + (present(item?.serialNumber) ? 2 : 0)
    + (row.actionLabel === 'Details verified' ? 5 : 0)
}

/** One row for each appliance. A later row replaces an earlier one only when it has more plate detail. */
export function oneRowPerAppliance<T extends InspectionAssessmentTableRow>(rows: readonly T[]): T[] {
  const chosen = new Map<string, T>()
  const order: string[] = []
  for (const row of rows) {
    const key = applianceFamily(row)
    const current = chosen.get(key)
    if (!current) {
      chosen.set(key, row)
      order.push(key)
      continue
    }
    if (plateScore(row) > plateScore(current)) chosen.set(key, row)
  }
  return order.map((key) => chosen.get(key) as T)
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

export function HomeCheckPanel({
  building,
  propertyId,
  equipmentRows = [],
  equipmentCheckedIds = [],
  onEquipmentCheckedIdsChange,
  onEquipmentChangeRow,
  equipmentActions = null,
}: {
  building: string
  propertyId?: string | null
  equipmentRows?: InspectionAssessmentTableRow[]
  equipmentCheckedIds?: string[]
  onEquipmentCheckedIdsChange?: (ids: string[]) => void
  onEquipmentChangeRow?: (id: string, result: ApplianceVisionResult) => void
  equipmentActions?: ReactNode
}) {
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
  const visibleChecks = list?.checks.filter((check) => {
    const record = check as ListedHomeCheck
    return record.assets.length > 0 || Boolean(record.issue_ticket_id)
  }) ?? []
  if (!visibleChecks.length && equipmentRows.length === 0) {
    return error ? <p role='alert' className='text-sm text-red-700'>{error}</p> : null
  }
  const homeRows: InspectionAssessmentTableRow[] = visibleChecks.flatMap((check) => {
    const record = check as ListedHomeCheck
    return record.assets.map((asset) => {
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
    })
  })
  const homeRowIds = new Set(homeRows.map((row) => row.id))
  const candidateRows = [
    ...homeRows,
    ...equipmentRows.filter((row) => !homeRowIds.has(row.id)),
  ]
  const photosDoNotMatch = candidateRows.some(isUnmatchedApplianceRow)
  const tableRows = oneRowPerAppliance(candidateRows.filter((row) => !isUnmatchedApplianceRow(row)))
  const displayedHomeIds = new Set(tableRows.map((row) => row.id))
  const tableChecks = visibleChecks.filter((check) =>
    check.assets.some((asset) => displayedHomeIds.has(asset.id))
  )
  const selectable = visibleChecks.some((check) => {
    const record = check as ListedHomeCheck
    return Boolean(record.completed_at && !record.confirmed_at && record.assets.length)
  }) || equipmentRows.length > 0
  return (
    <div className='space-y-4'>
      {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
      {tableChecks.some((check) => {
        const record = check as ListedHomeCheck
        return Boolean(record.completed_at && !record.confirmed_at && record.assets.length)
      }) || equipmentActions ? (
        <div className='flex flex-wrap justify-end gap-2'>
          {tableChecks.map((check) => {
            const record = check as ListedHomeCheck
            const canReview = Boolean(record.completed_at && !record.confirmed_at && record.assets.length)
            if (!canReview) return null
            const selectedHere = record.assets.filter((asset) =>
              selectedAssetIds.includes(asset.id) && !asset.verified
            )
            const confirmBlocked = busy || record.assets.length !== 2 || record.photos.some((photo) =>
              photo.state === 'queued' || photo.state === 'analyzing'
            ) || record.assets.some((asset) =>
              asset.labelReadability?.retakeRequested && !labelEdits[asset.id]
            )
            return (
              <div key={record.id} className='flex flex-wrap justify-end gap-2'>
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
            )
          })}
          {equipmentActions}
        </div>
      ) : null}
      {photosDoNotMatch ? (
        <div
          role='alert'
          className='flex items-center gap-2 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] leading-5 text-[#92400e]'
        >
          <svg viewBox='0 0 20 20' className='size-5 shrink-0' aria-hidden>
            <path
              fill='currentColor'
              d='M10 1.8 1.6 17.2h16.8L10 1.8Zm0 5.2a.9.9 0 0 1 .9.9v3.6a.9.9 0 1 1-1.8 0V7.9a.9.9 0 0 1 .9-.9Zm0 8.2a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z'
            />
          </svg>
          <p>Recent photos do not match the selected system. Please try again.</p>
        </div>
      ) : null}
      {tableRows.length > 0 && (
        <InspectionAssessmentTable
          rows={tableRows}
          checkedIds={selectable ? [...selectedAssetIds, ...equipmentCheckedIds] : undefined}
          onCheckedIdsChange={selectable ? (ids) => {
            setSelectedAssetIds(ids.filter((id) => homeRowIds.has(id)))
            onEquipmentCheckedIdsChange?.(ids.filter((id) => !homeRowIds.has(id)))
          } : undefined}
          onChangeRow={(id, result) => {
            if (!homeRowIds.has(id)) {
              onEquipmentChangeRow?.(id, result)
              return
            }
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
      {visibleChecks.map((check) => {
        const record = check as ListedHomeCheck
        if (!record.issue_ticket_id) return null
        return (
          <p key={record.id} className='text-sm text-[#92400e]'>
            {homeCheckFollowUpExplanation({
              warningSigns: record.answers?.warningSigns,
              warningDetails: record.answers?.warningDetails,
              detectedWarning: record.detected_warning,
            })}
          </p>
        )
      })}
    </div>
  )
}
