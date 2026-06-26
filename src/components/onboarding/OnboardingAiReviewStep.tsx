import { useState } from 'react'
import { TableCheckbox } from '@/components/TableCheckbox'
import {
  countSelectedInReview,
  setAllReviewSelections,
  type ExtractedFinancialRecord,
  type ExtractedLeaseInfo,
  type ExtractedReviewItem,
  type OnboardingExtractionReview,
  type OnboardingExtractedMaintenanceIssue,
  type OnboardingExtractedProperty,
  type OnboardingExtractedResident,
  type OnboardingExtractedUnit,
  type OnboardingExtractedVendor,
} from '@/lib/onboardingDocumentUpload'

const btnPrimary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[#187960] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#146b52] disabled:cursor-not-allowed disabled:opacity-50'

const btnSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-5 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

const btnGhost =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] px-4 py-2.5 text-[14px] font-medium text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-50'

const inputClass =
  'mt-1 h-9 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[13px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

function ConfidenceBadge({ value }: { value: number }) {
  const tone =
    value >= 90 ? 'text-[#187930] bg-[#ecfdf3]' : value >= 80 ? 'text-[#186179] bg-[#eef6fa]' : 'text-[#a65f00] bg-[#fef9c2]'
  return (
    <span className={`inline-flex rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
      {value}% confidence
    </span>
  )
}

function ReviewItemRow({
  checked,
  onToggle,
  label,
  value,
  sourceDocumentName,
  confidence,
  needsReview,
  editing,
  editValue,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onEditChange,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  value: string
  sourceDocumentName: string
  confidence: number
  needsReview?: boolean
  editing: boolean
  editValue: string
  onEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditChange: (value: string) => void
}) {
  return (
    <li className="rounded-[8px] border border-[#eef0f3] px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <TableCheckbox aria-label={`Include ${label}`} checked={checked} onChange={onToggle} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-[#101828]">{label}</p>
            <ConfidenceBadge value={confidence} />
            {needsReview ? (
              <span className="rounded-[4px] bg-[#fef9c2] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#a65f00]">
                Needs review
              </span>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-2">
              <input className={inputClass} value={editValue} onChange={(e) => onEditChange(e.target.value)} />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={onSaveEdit} className="text-[12px] font-medium text-[#187960]">
                  Save
                </button>
                <button type="button" onClick={onCancelEdit} className="text-[12px] font-medium text-[#6a7282]">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-[#364153]">{value}</p>
          )}
          <p className="mt-1 text-[11px] text-[#9ca3af]">Source: {sourceDocumentName}</p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-[12px] font-medium text-[#9E439F] hover:text-[#863786]"
          >
            Edit
          </button>
        ) : null}
      </div>
    </li>
  )
}

function ReviewSection({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string
  count: number
  emptyLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h3 className="text-[15px] font-semibold text-[#101828]">
        {title} ({count})
      </h3>
      {children ?? <p className="mt-2 text-[13px] text-[#6a7282]">{emptyLabel}</p>}
    </section>
  )
}

export type OnboardingAiReviewStepProps = {
  review: OnboardingExtractionReview
  saving: boolean
  onReviewChange: (review: OnboardingExtractionReview) => void
  onBackToUploads: () => void
  onImportSelected: () => void
  onImportAll: () => void
  onSkipImport: () => void
}

export function OnboardingAiReviewStep({
  review,
  saving,
  onReviewChange,
  onBackToUploads,
  onImportSelected,
  onImportAll,
  onSkipImport,
}: OnboardingAiReviewStepProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const selectedCount = countSelectedInReview(review)
  const isEmpty =
    review.properties.length === 0 &&
    review.units.length === 0 &&
    review.residents.length === 0 &&
    review.leases.length === 0 &&
    review.vendors.length === 0 &&
    review.maintenanceIssues.length === 0 &&
    review.financialRecords.length === 0

  function startEdit(id: string, value: string) {
    setEditingId(id)
    setEditDraft(value)
  }

  function saveEdit<T extends { id: string }>(
    section: keyof OnboardingExtractionReview,
    field: string,
    items: T[],
    getValue: (item: T) => string,
  ) {
    onReviewChange({
      ...review,
      [section]: items.map((item) =>
        item.id === editingId ? { ...item, [field]: editDraft } : item,
      ),
    } as OnboardingExtractionReview)
    setEditingId(null)
    setEditDraft('')
  }

  function renderPropertyRows() {
    if (review.properties.length === 0) {
      return <p className="mt-2 text-[13px] text-[#6a7282]">No properties detected.</p>
    }
    return (
      <ul className="mt-3 space-y-2">
        {review.properties.map((item) => (
          <ReviewItemRow
            key={item.id}
            checked={item.selected}
            onToggle={() =>
              onReviewChange({
                ...review,
                properties: review.properties.map((row) =>
                  row.id === item.id ? { ...row, selected: !row.selected } : row,
                ),
              })
            }
            label={item.name}
            value={`${item.address} · ${item.propertyType} · Units ${item.unitLabels}`}
            sourceDocumentName={item.sourceDocumentName}
            confidence={item.confidence}
            needsReview={item.needsReview}
            editing={editingId === item.id}
            editValue={editDraft}
            onEdit={() => startEdit(item.id, item.address)}
            onSaveEdit={() => saveEdit('properties', 'address', review.properties, (row) => row.address)}
            onCancelEdit={() => setEditingId(null)}
            onEditChange={setEditDraft}
          />
        ))}
      </ul>
    )
  }

  function renderSimpleRows<T extends { id: string; selected: boolean; sourceDocumentName: string; confidence: number; needsReview?: boolean }>(
    items: T[],
    section: keyof OnboardingExtractionReview,
    labelFor: (item: T) => string,
    valueFor: (item: T) => string,
    editField: string,
    getEditValue: (item: T) => string,
    emptyLabel: string,
  ) {
    if (items.length === 0) return <p className="mt-2 text-[13px] text-[#6a7282]">{emptyLabel}</p>
    return (
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <ReviewItemRow
            key={item.id}
            checked={item.selected}
            onToggle={() =>
              onReviewChange({
                ...review,
                [section]: items.map((row) =>
                  row.id === item.id ? { ...row, selected: !row.selected } : row,
                ),
              } as OnboardingExtractionReview)
            }
            label={labelFor(item)}
            value={valueFor(item)}
            sourceDocumentName={item.sourceDocumentName}
            confidence={item.confidence}
            needsReview={item.needsReview}
            editing={editingId === item.id}
            editValue={editDraft}
            onEdit={() => startEdit(item.id, getEditValue(item))}
            onSaveEdit={() => saveEdit(section, editField, items, getEditValue)}
            onCancelEdit={() => setEditingId(null)}
            onEditChange={setEditDraft}
          />
        ))}
      </ul>
    )
  }

  function renderNeedsReviewRows() {
    if (review.needsReview.length === 0 && review.imageLabels.length === 0) {
      return <p className="mt-2 text-[13px] text-[#6a7282]">No items flagged for manual review.</p>
    }
    const combined = [...review.needsReview, ...review.imageLabels]
    return (
      <ul className="mt-3 space-y-2">
        {combined.map((item) => (
          <ReviewItemRow
            key={item.id}
            checked={item.includeInImport}
            onToggle={() => {
              const inNeeds = review.needsReview.some((row) => row.id === item.id)
              if (inNeeds) {
                onReviewChange({
                  ...review,
                  needsReview: review.needsReview.map((row) =>
                    row.id === item.id ? { ...row, includeInImport: !row.includeInImport } : row,
                  ),
                })
              } else {
                onReviewChange({
                  ...review,
                  imageLabels: review.imageLabels.map((row) =>
                    row.id === item.id ? { ...row, includeInImport: !row.includeInImport } : row,
                  ),
                })
              }
            }}
            label={item.label}
            value={item.imageTags?.length ? `${item.value} · Tags: ${item.imageTags.join(', ')}` : item.value}
            sourceDocumentName={item.sourceDocumentName}
            confidence={item.confidence}
            needsReview={item.needsReview}
            editing={editingId === item.id}
            editValue={editDraft}
            onEdit={() => startEdit(item.id, item.value)}
            onSaveEdit={() => {
              onReviewChange({
                ...review,
                needsReview: review.needsReview.map((row) =>
                  row.id === item.id ? { ...row, value: editDraft } : row,
                ),
                imageLabels: review.imageLabels.map((row) =>
                  row.id === item.id ? { ...row, value: editDraft } : row,
                ),
              })
              setEditingId(null)
            }}
            onCancelEdit={() => setEditingId(null)}
            onEditChange={setEditDraft}
          />
        ))}
      </ul>
    )
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="text-[18px] font-semibold text-[#101828]">Review and Approve Information</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-[#6a7282]">
      Nothing will be added until you approve it.
      </p>

      {isEmpty ? (
        <div className="mt-4 rounded-[10px] border border-dashed border-[#e5e7eb] bg-[#fafafa] px-4 py-8 text-center">
          <p className="text-[14px] font-medium text-[#101828]">No extracted data yet</p>
          <p className="mt-1 text-[13px] text-[#6a7282]">
            Upload documents to extract properties, residents, vendors, and financial records — or skip
            import to continue onboarding.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <ReviewSection title="Properties Found" count={review.properties.length} emptyLabel="">
            {renderPropertyRows()}
          </ReviewSection>
          <ReviewSection title="Units Found" count={review.units.length} emptyLabel="">
            {renderSimpleRows<OnboardingExtractedUnit>(
              review.units,
              'units',
              (item) => `Unit ${item.label}`,
              (item) => item.building,
              'building',
              (item) => item.building,
              'No units detected.',
            )}
          </ReviewSection>
          <ReviewSection title="Residents Found" count={review.residents.length} emptyLabel="">
            {renderSimpleRows<OnboardingExtractedResident>(
              review.residents,
              'residents',
              (item) => item.fullName,
              (item) => `${item.unit} · ${item.phone} · ${item.email}`,
              'email',
              (item) => item.email,
              'No residents detected.',
            )}
          </ReviewSection>
          <ReviewSection title="Lease Information Found" count={review.leases.length} emptyLabel="">
            {renderSimpleRows<ExtractedLeaseInfo>(
              review.leases,
              'leases',
              (item) => item.residentName,
              (item) =>
                `${item.leaseStart} – ${item.leaseEnd} · Rent ${item.rentAmount} · Deposit ${item.securityDeposit}`,
              'rentAmount',
              (item) => item.rentAmount,
              'No lease information detected.',
            )}
          </ReviewSection>
          <ReviewSection title="Vendors Found" count={review.vendors.length} emptyLabel="">
            {renderSimpleRows<OnboardingExtractedVendor>(
              review.vendors,
              'vendors',
              (item) => item.name,
              (item) => [item.category, item.phone, item.email].filter(Boolean).join(' · '),
              'email',
              (item) => item.email,
              'No vendors detected.',
            )}
          </ReviewSection>
          <ReviewSection title="Maintenance Issues Found" count={review.maintenanceIssues.length} emptyLabel="">
            {renderSimpleRows<OnboardingExtractedMaintenanceIssue>(
              review.maintenanceIssues,
              'maintenanceIssues',
              (item) => item.description,
              (item) =>
                `${item.building} · Unit ${item.unit}${item.imageTags?.length ? ` · ${item.imageTags.join(', ')}` : ''}`,
              'description',
              (item) => item.description,
              'No maintenance issues detected.',
            )}
          </ReviewSection>
          <ReviewSection title="Financial Records Found" count={review.financialRecords.length} emptyLabel="">
            {renderSimpleRows<ExtractedFinancialRecord>(
              review.financialRecords,
              'financialRecords',
              (item) => item.recordType,
              (item) => `${item.description} · ${item.amount} · ${item.period}`,
              'amount',
              (item) => item.amount,
              'No financial records detected.',
            )}
          </ReviewSection>
          <ReviewSection
            title="Items Needing Review"
            count={review.needsReview.length + review.imageLabels.length}
            emptyLabel=""
          >
            {renderNeedsReviewRows()}
          </ReviewSection>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4 border-t border-[#eef0f3] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[#6a7282]">
            {selectedCount} item{selectedCount === 1 ? '' : 's'} selected for import
          </p>
          {!isEmpty ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onReviewChange(setAllReviewSelections(review, true))}
                className="text-[12px] font-medium text-[#186179] hover:text-[#0f4d61]"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onReviewChange(setAllReviewSelections(review, false))}
                className="text-[12px] font-medium text-[#6a7282] hover:text-[#101828]"
              >
                Deselect all
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={saving} onClick={onBackToUploads} className={btnGhost}>
            Back to uploads
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={saving} onClick={onSkipImport} className={btnSecondary}>
              Skip import
            </button>
            <button
              type="button"
              disabled={saving || selectedCount === 0}
              onClick={onImportSelected}
              className={btnSecondary}
            >
              Import selected
            </button>
            <button
              type="button"
              disabled={saving || isEmpty}
              onClick={onImportAll}
              className={btnPrimary}
            >
              Import everything
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
