import type { ApplianceVisionResult, ConditionRating, VisionCategory } from '@/lib/vision/types'
import { InspectionPhotoExtractProgress } from '@/components/InspectionPhotoExtractProgress'
import {
  assessmentActionLabel,
  assessmentBrandModel,
  assessmentCategoryLabel,
  assessmentConditionLabel,
  assessmentConfidencePercent,
  assessmentConfidenceReason,
  assessmentDescription,
  assessmentSerial,
} from '@/lib/inspectionAssessmentTable'

const CATEGORIES: VisionCategory[] = [
  'appliance',
  'hvac',
  'water_heater',
  'boiler',
  'roof',
  'other',
  'unknown',
]

const CONDITIONS: ConditionRating[] = ['good', 'fair', 'poor', 'unsafe']

const CELL =
  'bg-transparent border-0 p-0 m-0 w-full min-w-0 outline-none focus:ring-0 appearance-none'

function assetGridClass(selectable: boolean, extra = '') {
  const columns = selectable
    ? '[grid-template-columns:1.75rem_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,0.7fr)_minmax(0,0.65fr)_minmax(0,0.85fr)_minmax(0,0.65fr)]'
    : '[grid-template-columns:minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,0.7fr)_minmax(0,0.65fr)_minmax(0,0.85fr)_minmax(0,0.65fr)]'
  return `grid w-full min-w-0 items-center gap-x-2 gap-y-1 px-3 py-4 sm:gap-x-3 sm:px-4 ${columns} ${extra}`.trim()
}

function ConfidenceInfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v5M12 8h.01" strokeLinecap="round" />
    </svg>
  )
}

function ConfidenceReasonButton({ reason }: { reason: string }) {
  return (
    <span className="group/conf relative inline-flex shrink-0">
      <button
        type="button"
        tabIndex={0}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex rounded-full p-0.5 text-[#94a3b8] outline-none hover:text-[#64748b] focus-visible:ring-2 focus-visible:ring-[#186179]"
        aria-label="Why this confidence"
      >
        <ConfidenceInfoIcon />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 bottom-full z-30 mb-1.5 w-[min(260px,calc(100vw-3rem))] rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-left text-[12px] font-medium leading-4 text-[#475569] opacity-0 shadow-[0px_8px_24px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/conf:opacity-100 group-focus-within/conf:opacity-100"
      >
        {reason}
      </span>
    </span>
  )
}

export type InspectionAssessmentTableRow = {
  id: string
  result?: ApplianceVisionResult | null
  previewUrl?: string | null
  extracting?: boolean
  extractComplete?: boolean
  editable?: boolean
}

type InspectionAssessmentTableProps = {
  rows: InspectionAssessmentTableRow[]
  selectedId?: string | null
  onSelectRow?: (id: string) => void
  onChangeRow?: (id: string, result: ApplianceVisionResult) => void
  checkedIds?: string[]
  onCheckedIdsChange?: (ids: string[]) => void
}

function RowCheckbox({
  checked,
  indeterminate = false,
  label,
  onChecked,
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  onChecked: (checked: boolean) => void
}) {
  return (
    <label
      className="flex w-7 shrink-0 cursor-pointer items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate && !checked
        }}
        onChange={(e) => onChecked(e.target.checked)}
        aria-label={label}
        className="size-4 cursor-pointer rounded border-[#cbd5e1] accent-[#186179]"
      />
    </label>
  )
}

function patchIdentified(
  result: ApplianceVisionResult,
  patch: Partial<ApplianceVisionResult['identifiedItem']>,
): ApplianceVisionResult {
  return {
    ...result,
    identifiedItem: { ...result.identifiedItem, ...patch },
  }
}

export function InspectionAssessmentTable({
  rows,
  selectedId,
  onSelectRow,
  onChangeRow,
  checkedIds,
  onCheckedIdsChange,
}: InspectionAssessmentTableProps) {
  if (rows.length === 0) return null

  const selectable = Boolean(onCheckedIdsChange)
  const checked = new Set(checkedIds ?? [])
  const allChecked = selectable && rows.length > 0 && rows.every((row) => checked.has(row.id))
  const someChecked = selectable && rows.some((row) => checked.has(row.id))

  return (
    <div className="w-full min-w-0 overflow-x-hidden pt-1">
      <div className="w-full min-w-0 rounded-[16px] border border-[#dce4e1] bg-white shadow-[0px_8px_24px_0px_rgba(18,53,42,0.07)]">
        <div className={`${assetGridClass(selectable)} rounded-t-[16px] bg-[#eef3f1] text-[12px] font-semibold leading-snug text-[#68717a]`}>
          {selectable ? (
            <RowCheckbox
              checked={allChecked}
              indeterminate={someChecked && !allChecked}
              label="Select all assets"
              onChecked={(value) => {
                onCheckedIdsChange?.(value ? rows.map((row) => row.id) : [])
              }}
            />
          ) : null}
          <p className="min-w-0 break-words text-center">Category</p>
          <p className="min-w-0 break-words">Brand / Model</p>
          <p className="min-w-0 break-words">Description</p>
          <p className="min-w-0 break-words text-right">Serial number</p>
          <p className="min-w-0 break-words text-right">Condition</p>
          <p className="min-w-0 break-words text-right">Action</p>
          <p className="min-w-0 break-words text-right">Confidence</p>
        </div>
        {rows.map((row, index) => {
          const { result, editable, previewUrl, extracting, extractComplete } = row
          const serial = result ? assessmentSerial(result) : ''
          const missingSerial = !serial
          const zebra = index % 2 === 1 ? 'bg-[#f5f8f7]' : 'bg-white'
          const canSelect = Boolean(onSelectRow) && !editable && !extracting
          return (
            <div
              key={row.id}
              role={canSelect ? 'button' : undefined}
              tabIndex={canSelect ? 0 : undefined}
              onClick={() => {
                if (canSelect) onSelectRow?.(row.id)
              }}
              onKeyDown={(e) => {
                if (!canSelect) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectRow?.(row.id)
                }
              }}
              className={`${assetGridClass(selectable)} text-[14px] leading-normal ${zebra} ${
                canSelect ? 'cursor-pointer' : ''
              } ${index === rows.length - 1 ? 'rounded-b-[16px]' : ''}`}
              aria-current={selectedId === row.id ? 'true' : undefined}
            >
              {selectable ? (
                <RowCheckbox
                  checked={checked.has(row.id)}
                  label={`Select ${result?.identifiedItem.type || row.id}`}
                  onChecked={(value) => {
                    const next = new Set(checked)
                    if (value) next.add(row.id)
                    else next.delete(row.id)
                    onCheckedIdsChange?.([...next])
                  }}
                />
              ) : null}
              <div className="flex min-w-0 flex-col items-center justify-center gap-1.5 text-center font-semibold text-[#1a1d20]">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-[8px] bg-[#eef3f1] object-cover"
                  />
                ) : (
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-[#eef3f1] text-[10px] font-medium text-[#94a3b8]"
                    aria-hidden
                  >
                    —
                  </span>
                )}
                {extracting ? null : editable && onChangeRow && result ? (
                  <select
                    aria-label="Category"
                    value={result.category}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChangeRow(row.id, {
                        ...result,
                        category: e.target.value as VisionCategory,
                      })
                    }
                    className={`${CELL} cursor-pointer text-center font-semibold text-[#1a1d20]`}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {assessmentCategoryLabel(cat)}
                      </option>
                    ))}
                  </select>
                ) : result ? (
                  <p className="min-w-0 break-words">{assessmentCategoryLabel(result.category)}</p>
                ) : null}
              </div>
              {extracting ? (
                <div className="col-span-6 flex min-w-0 items-center">
                  <InspectionPhotoExtractProgress
                    photoId={row.id}
                    complete={Boolean(extractComplete)}
                  />
                </div>
              ) : result ? (
                <>
              <div className="flex min-w-0 items-center overflow-hidden font-medium text-[#68717a]">
                {editable && onChangeRow ? (
                  <div className="flex min-w-0 items-baseline gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      aria-label="Brand"
                      placeholder="Unknown"
                      value={result.identifiedItem.brand ?? ''}
                      onChange={(e) =>
                        onChangeRow(
                          row.id,
                          patchIdentified(result, {
                            brand: e.target.value || undefined,
                          }),
                        )
                      }
                      className={`${CELL} min-w-0 flex-1 font-medium text-[#68717a] placeholder:text-[#68717a]`}
                    />
                    <span className="shrink-0 text-[#68717a]">/</span>
                    <input
                      aria-label="Model"
                      placeholder="-"
                      value={result.identifiedItem.modelNumber ?? ''}
                      onChange={(e) =>
                        onChangeRow(
                          row.id,
                          patchIdentified(result, {
                            modelNumber: e.target.value || undefined,
                          }),
                        )
                      }
                      className={`${CELL} min-w-0 flex-1 font-medium text-[#68717a] placeholder:text-[#68717a]`}
                    />
                  </div>
                ) : (
                  <p className="min-w-0 break-words">{assessmentBrandModel(result)}</p>
                )}
              </div>
              <div className="flex min-w-0 items-center overflow-hidden font-medium text-[#68717a]">
                {editable && onChangeRow ? (
                  <textarea
                    aria-label="Description"
                    rows={2}
                    value={result.condition.summary}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChangeRow(row.id, {
                        ...result,
                        condition: { ...result.condition, summary: e.target.value },
                      })
                    }
                    className={`${CELL} resize-none font-medium text-[#68717a]`}
                  />
                ) : (
                  <p className="min-w-0 break-words">{assessmentDescription(result)}</p>
                )}
              </div>
              <div
                className={`flex min-w-0 items-center justify-end overflow-hidden font-semibold ${
                  missingSerial ? 'text-[#a03e3e]' : 'text-[#1a1d20]'
                }`}
              >
                {editable && onChangeRow ? (
                  <input
                    aria-label="Serial number"
                    value={serial}
                    placeholder="-"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChangeRow(
                        row.id,
                        patchIdentified(result, {
                          serialNumber: e.target.value || undefined,
                        }),
                      )
                    }
                    className={`${CELL} text-right font-semibold placeholder:text-[#a03e3e] ${
                      missingSerial ? 'text-[#a03e3e]' : 'text-[#1a1d20]'
                    }`}
                  />
                ) : (
                  <p className="min-w-0 break-all text-right">{missingSerial ? '-' : serial}</p>
                )}
              </div>
              <div className="flex min-w-0 items-center justify-end overflow-hidden font-medium text-[#68717a]">
                {editable && onChangeRow ? (
                  <select
                    aria-label="Condition"
                    value={result.condition.rating}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChangeRow(row.id, {
                        ...result,
                        condition: {
                          ...result.condition,
                          rating: e.target.value as ConditionRating,
                        },
                      })
                    }
                    className={`${CELL} cursor-pointer text-right font-medium text-[#68717a]`}
                  >
                    {CONDITIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {assessmentConditionLabel(opt)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="min-w-0 break-words text-right">
                    {assessmentConditionLabel(result.condition.rating)}
                  </p>
                )}
              </div>
              <div className="flex min-w-0 items-center justify-end overflow-hidden font-medium text-[#68717a]">
                <p
                  className={`min-w-0 break-words text-right ${
                    assessmentActionLabel(result) === 'Safety hazard'
                      ? 'font-semibold text-[#a03e3e]'
                      : assessmentActionLabel(result) === 'Repair recommended'
                        ? 'text-[#b45309]'
                        : ''
                  }`}
                >
                  {assessmentActionLabel(result)}
                </p>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden font-medium text-[#68717a]">
                <p className="min-w-0 tabular-nums">{assessmentConfidencePercent(result)}%</p>
                <ConfidenceReasonButton reason={assessmentConfidenceReason(result)} />
              </div>
                </>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default InspectionAssessmentTable
