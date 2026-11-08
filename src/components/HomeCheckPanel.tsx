import { HomeCheckSerialReview } from './HomeCheckSerialReview'
import { removeInspectionAsset } from '@/api/inspectionAssetAssess'
import { InspectionAssessmentTable, type InspectionAssessmentTableRow } from './InspectionAssessmentTable'
import { PmHomeCheckPhotoReviews } from './PmHomeCheckPhotoReviews'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApplianceVisionResult } from '@/lib/vision/types'
import { isUnmatchedApplianceRow } from '@/lib/inspectionAssessmentTable'
import { type HomeCheckList, homeCheckRequest } from '@/api/homeCheck'
import { supabase } from '@/lib/supabase'
import { HOME_CHECK_CHANGED_EVENT } from '@/lib/homeCheckEvents'
import {
  HOME_CHECK_MONTHS,
  homeCheckAssetPreview,
  homeCheckReviewLabels,
  homeCheckReviewResult,
  type HomeCheckLabelDraft,
} from '@/lib/homeCheckReview'

type ListedHomeCheck = HomeCheckList['checks'][number] & {
  completed_at?: string | null
  confirmed_at?: string | null
  labels_readable?: boolean | null
  issue_ticket_id?: string | null
}

/** Historical value is a review candidate only; never merge it into current analysis. */
export function previousSerialForReview(check: ListedHomeCheck, asset: ListedHomeCheck['assets'][number], checks: readonly ListedHomeCheck[]): string | undefined {
  if (asset.fields.serial.value || asset.fields.serial.source === 'landlord') return undefined
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const make = normalize(asset.fields.make.value), model = normalize(asset.fields.model.value)
  if (!make || !model) return undefined
  const prior = checks.filter(row => row.id !== check.id && row.confirmed_at
    && normalize(row.unit_label) === normalize(check.unit_label)
    && Date.parse(row.created_at) < Date.parse(check.created_at))
    .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  for (const row of prior) {
    const matches = row.assets.filter(old => old.verified && old.system === asset.system
      && normalize(old.fields.make.value) === make && normalize(old.fields.model.value) === model
      && old.fields.serial.value)
    const values = [...new Set(matches.map(old => String(old.fields.serial.value).trim()))]
    if (values.length) return values.length === 1 ? values[0] : undefined
  }
  return undefined
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
  const made = row.result?.manufactureDate
  return (present(item?.brand) ? 2 : 0)
    + (present(item?.modelNumber) ? 2 : 0)
    + (present(item?.serialNumber) ? 2 : 0)
    + (made?.year || made?.month ? 1 : 0)
    + (row.actionLabel === 'Details verified' ? 5 : 0)
}

/** Latest Home Check snapshot wins as a whole; never borrow old verified fields into a new draft. */
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
    const date = Date.parse(row.recordedAt ?? '')
    const currentDate = Date.parse(current.recordedAt ?? '')
    const dated = Number.isFinite(date)
    const currentDated = Number.isFinite(currentDate)
    if (dated && (!currentDated || date > currentDate)) chosen.set(key, row)
    else if (dated === currentDated && (!dated || date === currentDate) &&
      plateScore(row) > plateScore(current)) chosen.set(key, row)
  }
  return order.map((key) => chosen.get(key) as T)
}

const PLATE_INPUT =
  'w-auto bg-transparent px-0 py-0.5 text-[13px] text-[#68717a] outline-none placeholder:text-[#94a3b8]'

function ManufactureDateFields(
  { draft, onChange }: { draft: HomeCheckLabelDraft; onChange: (next: HomeCheckLabelDraft) => void },
) {
  return (
    <div className='flex flex-col items-end gap-1'>
      <select
        aria-label='Manufacture month'
        value={draft.manufactureMonth}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange({ ...draft, manufactureMonth: event.target.value })}
        className={`${PLATE_INPUT} max-w-full text-right`}
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
        className={`${PLATE_INPUT} w-16 text-right`}
      />
    </div>
  )
}

export function HomeCheckPanel({
  propertyId,
  equipmentRows = [],
  equipmentCheckedIds = [],
  onEquipmentCheckedIdsChange,
  onEquipmentChangeRow,
  onAssetsDeleted,
}: {
  building: string
  propertyId?: string | null
  equipmentRows?: InspectionAssessmentTableRow[]
  equipmentCheckedIds?: string[]
  onEquipmentCheckedIdsChange?: (ids: string[]) => void
  onEquipmentChangeRow?: (id: string, result: ApplianceVisionResult) => void
  onAssetsDeleted?: (ids: string[]) => void | Promise<void>
}) {
  const [list, setList] = useState<HomeCheckList | null>(null)
  const [loadedPropertyId, setLoadedPropertyId] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const reviewScopeVersion = useRef(0)
  const [error, setError] = useState('')
  const [serialSaved, setSerialSaved] = useState(false)
  const [serialReview, setSerialReview] = useState<{propertyId:string;checkId:string;assetId:string;photoId:string;value:string;previouslySaved:boolean;previewUrl:string|null}|null>(null)
  const [deleting, setDeleting] = useState(false)
  const [labelEdits, setLabelEdits] = useState<Record<string, HomeCheckLabelDraft>>({})
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const refresh = useCallback(async () => {
    if (!propertyId || !supabase) return
    const version = ++requestVersion.current
    const result = await homeCheckRequest<HomeCheckList>({ action: 'list', propertyId })
    if (version !== requestVersion.current) return
    setList(result)
    setLoadedPropertyId(propertyId)
  }, [propertyId])
  useEffect(() => {
    let cancelled = false
    reviewScopeVersion.current++
    setError('')
    setSerialReview(null)
    setSerialSaved(false)
    setSelectedAssetIds([])
    setLabelEdits({})
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
      requestVersion.current++
      reviewScopeVersion.current++
      window.clearInterval(timer)
      window.removeEventListener(HOME_CHECK_CHANGED_EVENT, onChanged)
    }
  }, [propertyId, refresh])
  async function deleteSelected(ids: string[]) {
    if (deleting || ids.length === 0) return
    setDeleting(true)
    setError('')
    const deleted: string[] = []
    try {
      for (const id of ids) {
        await removeInspectionAsset(id)
        deleted.push(id)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Could not delete the selected records.'
      setError(deleted.length ? `Deleted ${deleted.length} of ${ids.length} selected records. ${reason}` : reason)
    } finally {
      if (deleted.length) {
        const removed = new Set(deleted)
        setSelectedAssetIds(previous => previous.filter(id => !removed.has(id)))
        onEquipmentCheckedIdsChange?.(equipmentCheckedIds.filter(id => !removed.has(id)))
        setList(previous => previous ? { ...previous, checks: previous.checks.map(check => ({
          ...check, assets: check.assets.filter(asset => !removed.has(asset.id)),
        })) } : previous)
        try {
          await onAssetsDeleted?.(deleted)
          await refresh()
        } catch {
          setError(previous => previous || 'Records were deleted, but the table could not refresh. Reload the page.')
        }
      }
      setDeleting(false)
    }
  }
  const visibleChecks = (loadedPropertyId === propertyId ? list : null)?.checks.filter((check) => {
    const record = check as ListedHomeCheck
    return record.assets.length > 0 || Boolean(record.issue_ticket_id)
  }) ?? []
  if (!visibleChecks.length && equipmentRows.length === 0) {
    return (
      <>
        {error ? <p role='alert' className='text-sm text-red-700'>{error}</p> : null}
        <PmHomeCheckPhotoReviews propertyId={propertyId} />
      </>
    )
  }
  const homeRows: InspectionAssessmentTableRow[] = visibleChecks.flatMap((check) => {
    const record = check as ListedHomeCheck
    return record.assets.map((asset) => {
      const draft = !asset.verified ? labelEdits[asset.id] : undefined
      const labels = homeCheckReviewLabels(asset)
      const result = homeCheckReviewResult(asset, draft)
      const previousSerial = previousSerialForReview(record, asset, visibleChecks)
      return {
        id: asset.id,
        recordedAt: record.created_at,
        previousSerial,
        onReviewSerial: !asset.verified && asset.fields.serial.photoIds[0] && propertyId ? () => setSerialReview({
          propertyId,checkId:record.id,assetId:asset.id,photoId:asset.fields.serial.photoIds[0],
          value:asset.fields.serial.value == null ? previousSerial ?? '' : String(asset.fields.serial.value),
          previouslySaved:Boolean(previousSerial),
          previewUrl:record.photos.find(p => p.slot === (asset.system === 'water_heater' ? 'water_heater_label' : 'heating_label'))?.previewUrl ?? null,
        }) : undefined,
        previewUrl: homeCheckAssetPreview(asset.system, record.photos),
        editable: Boolean(draft),
        labelFieldsOnly: true,
        categoryLabel: labels.categoryLabel,
        conditionLabel: labels.conditionLabel,
        actionLabel: labels.actionLabel,
        result: labels.actionLabel === 'Details verified'
          ? { ...result, labelReadability: undefined }
          : result,
        madeExtra: draft
          ? (
            <ManufactureDateFields
              draft={draft}
              onChange={(next) =>
                setLabelEdits((previous) => ({ ...previous, [asset.id]: next }))}
            />
          )
          : undefined,
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
  const visibleIds = new Set(tableRows.map(row => row.id))
  const selectedIds = [...new Set([...selectedAssetIds, ...equipmentCheckedIds])].filter(id => visibleIds.has(id))
  const selectable = tableRows.length > 0
  return (
    <div className='space-y-4'>
      {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
      {serialSaved ? <p role='status' className='text-sm text-[#186179]'>Serial review saved. This did not confirm the Home Check.</p> : null}
      {selectedIds.length > 0 ? (
        <div className='flex justify-end'>
          <button
            type='button'
            disabled={deleting}
            onClick={() => void deleteSelected([...selectedIds])}
            className='rounded-[10px] border border-[#fecaca] bg-white px-4 py-2 text-[13px] font-semibold text-[#a03e3e] hover:bg-[#fef2f2] disabled:opacity-40'
          >
            {deleting ? 'Deleting…' : `Delete selected (${selectedIds.length})`}
          </button>
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
      {tableRows.length > 0 ? (
        <div className='space-y-3'>
          <h3 className='text-[18px] font-semibold leading-6 text-[#0d0f11]'>Appliance equipment</h3>
          <InspectionAssessmentTable
            rows={tableRows}
            showActionColumn={false}
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
        </div>
      ) : null}
      <PmHomeCheckPhotoReviews propertyId={propertyId} />
      {serialReview && serialReview.propertyId === propertyId ? <HomeCheckSerialReview
        key={`${serialReview.assetId}:${serialReview.photoId}`} value={serialReview.value} previouslySaved={serialReview.previouslySaved} previewUrl={serialReview.previewUrl}
        onClose={() => setSerialReview(current => current === serialReview ? null : current)}
        onSave={async serial => {
          const version = reviewScopeVersion.current
          await homeCheckRequest({action:'serial_review',id:serialReview.checkId,propertyId:serialReview.propertyId,
            assetId:serialReview.assetId,photoId:serialReview.photoId,serial,unknown:serial===null})
          if (version !== reviewScopeVersion.current) return
          setSerialSaved(true)
          try { await refresh() } catch { setError('The serial review was saved, but the table could not refresh. Reload the page.') }
          window.dispatchEvent(new CustomEvent(HOME_CHECK_CHANGED_EVENT,{detail:{propertyId:serialReview.propertyId}}))
        }} /> : null}
    </div>
  )
}
