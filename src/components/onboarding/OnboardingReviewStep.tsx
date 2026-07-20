import type { ReactNode } from 'react'
import type {
  OnboardingResident,
  OnboardingReviewData,
  OnboardingStep,
} from '@/lib/landlordOnboarding'

function formatRentDueDayOrdinal(day: number): string {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function formatResidentReviewValue(resident: OnboardingResident): string {
  const parts: string[] = [resident.fullName]
  if (resident.unit) parts.push(`Unit ${resident.unit}`)
  if (resident.monthlyRent != null && Number.isFinite(resident.monthlyRent)) {
    parts.push(
      `$${resident.monthlyRent.toLocaleString('en-US', {
        maximumFractionDigits: 2,
      })}/mo`,
    )
  }
  if (resident.rentDueDay != null) {
    parts.push(`Due ${formatRentDueDayOrdinal(resident.rentDueDay)}`)
  }
  if (resident.leaseStart || resident.leaseEnd) {
    parts.push(
      `Lease ${resident.leaseStart ?? '—'} – ${resident.leaseEnd ?? '—'}`,
    )
  }
  return parts.join(' · ')
}

function ReviewProgressIcon() {
  return (
    <div className="relative mx-auto flex size-14 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 56 56" fill="none" className="size-14">
        <circle cx="28" cy="28" r="24" stroke="#E5E7EB" strokeWidth="3" />
        <path
          d="M28 4a24 24 0 0 1 24 24"
          stroke="#186179"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute flex size-9 items-center justify-center rounded-full bg-[#92C5DB]">
        <svg viewBox="0 0 16 16" fill="none" className="size-4">
          <path
            d="M3.5 8.25 6.5 11.25 12.5 4.75"
            stroke="#186179"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
      <path
        d="M11.333 2A1.886 1.886 0 0 1 14 4.667l-9 9-3.667 1 1-3.667 9-9Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ReviewSummaryRow({ label, value }: { label: string; value: ReactNode }) {
  const display = value == null || value === '' ? '—' : value
  return (
    <div className="flex items-start justify-between gap-8 border-b border-[#eef0f3] py-4 last:border-b-0">
      <dt className="max-w-[45%] text-[15px] font-medium leading-snug text-[#374151]">{label}</dt>
      <dd className="max-w-[55%] text-right text-[15px] leading-snug text-[#6b7280]">{display}</dd>
    </div>
  )
}

function ReviewSummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-[#e8eaef] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-[17px] font-semibold tracking-[-0.2px] text-[#111827]">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1.5 text-[14px] font-medium text-[#9E439F] transition-colors hover:text-[#863786]"
        >
          <EditIcon />
          Edit
        </button>
      </div>
      <dl>{children}</dl>
    </section>
  )
}

function formatPropertyLine(property: OnboardingReviewData['properties'][number]): string {
  const address = [property.streetAddress, property.city, property.state, property.zipCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
  const unitLabel = property.unitCount === 1 ? '1 unit' : `${property.unitCount} units`
  return [property.name, address, unitLabel].filter(Boolean).join(' · ')
}

function formatVendorCategory(category: string): string {
  const value = category.trim()
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

const btnReviewPrimary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[#187960] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#146b52] disabled:cursor-not-allowed disabled:opacity-50'

const btnReviewSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

export type OnboardingReviewStepProps = {
  loading: boolean
  saving: boolean
  reviewData: OnboardingReviewData | null
  completionDisabled: boolean
  completionMissing: string[]
  onEditStep: (step: OnboardingStep) => void
  onBack: () => void
  onComplete: () => void
}

export function OnboardingReviewStep({
  loading,
  saving,
  reviewData,
  completionDisabled,
  completionMissing,
  onEditStep,
  onBack,
  onComplete,
}: OnboardingReviewStepProps) {
  const companyName = reviewData?.accountSetup.companyName.trim()
  const contactName = reviewData?.accountSetup.contactName.trim()
  const headline = companyName
    ? `Ready to launch Ulo for ${companyName}?`
    : contactName
      ? `Ready to launch Ulo, ${contactName}?`
      : 'Ready to complete your setup?'

  return (
    <div className="mx-auto w-full max-w-[680px]">
      <div className="text-center">
        <ReviewProgressIcon />
        <h2 className="mt-5 text-[28px] font-semibold leading-tight tracking-[-0.5px] text-[#111827] sm:text-[32px]">
          {headline}
        </h2>
        <p className="mx-auto mt-3 max-w-[540px] text-[15px] leading-relaxed text-[#6b7280]">
          If the details look good, complete setup to open your dashboard. You can go back and edit any
          section before finishing.
        </p>
      </div>

      {loading || !reviewData ? (
        <p className="mt-10 text-center text-[14px] text-[#6a7282]">Loading your setup…</p>
      ) : (
        <div className="mt-8 space-y-4">
          <ReviewSummaryCard title="Account" onEdit={() => onEditStep('account_setup')}>
            <ReviewSummaryRow label="Company" value={reviewData.accountSetup.companyName} />
            <ReviewSummaryRow label="Contact" value={reviewData.accountSetup.contactName} />
            <ReviewSummaryRow label="Email" value={reviewData.accountSetup.email} />
            <ReviewSummaryRow label="Phone" value={reviewData.accountSetup.phone} />
          </ReviewSummaryCard>

          <ReviewSummaryCard title="Properties" onEdit={() => onEditStep('property')}>
            {reviewData.properties.length > 0 ? (
              reviewData.properties.map((property, index) => (
                <ReviewSummaryRow
                  key={property.id}
                  label={reviewData.properties.length > 1 ? `Property ${index + 1}` : 'Property'}
                  value={formatPropertyLine(property)}
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Properties"
                value="You can add properties from the property step."
              />
            )}
            <ReviewSummaryRow
              label="Total units"
              value={String(reviewData.metrics.units)}
            />
          </ReviewSummaryCard>

          <ReviewSummaryCard title="Vendors" onEdit={() => onEditStep('vendors')}>
            {reviewData.vendors.length > 0 ? (
              reviewData.vendors.map((vendor, index) => (
                <ReviewSummaryRow
                  key={vendor.id}
                  label={reviewData.vendors.length > 1 ? `Vendor ${index + 1}` : 'Vendor'}
                  value={[vendor.name, formatVendorCategory(vendor.category)].filter((part) => part && part !== '—').join(' · ')}
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Vendors"
                value="No vendors added yet. You can add vendors anytime."
              />
            )}
          </ReviewSummaryCard>

          <ReviewSummaryCard title="Residents" onEdit={() => onEditStep('residents')}>
            {reviewData.residents.length > 0 ? (
              reviewData.residents.map((resident, index) => (
                <ReviewSummaryRow
                  key={resident.id}
                  label={reviewData.residents.length > 1 ? `Resident ${index + 1}` : 'Resident'}
                  value={formatResidentReviewValue(resident)}
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Residents"
                value="No residents added yet. You can add residents anytime."
              />
            )}
          </ReviewSummaryCard>
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={saving || loading}
            onClick={onBack}
            className={btnReviewSecondary}
          >
            Back
          </button>
          <button
            type="button"
            disabled={saving || loading || completionDisabled}
            onClick={onComplete}
            className={btnReviewPrimary}
          >
            Complete setup
          </button>
        </div>
        {completionDisabled && completionMissing.length > 0 && !loading ? (
          <p className="max-w-[480px] text-center text-[13px] leading-relaxed text-[#6b7280]">
            Complete required setup: {completionMissing.join(', ')}. Use Edit on the summary cards above to
            fill in missing details.
          </p>
        ) : null}
      </div>
    </div>
  )
}
