import { useId, useState, type ReactNode } from 'react'
import type {
  OnboardingResident,
  OnboardingReviewData,
  OnboardingSetupPath,
  OnboardingStep,
} from '@/lib/onboarding'
import { communicationStyleLabel } from '@/lib/communicationStyle'
import { formatRentDueDayOrdinal, onboardingOccupancyStatusLabel } from '@/lib/onboarding'
import {
  afterHoursRuleLabel,
  emergencyTypeLabel,
  marketplacePreferenceLabel,
  notificationChannelLabel,
  notificationPreferenceLabel,
  quietHoursLabel,
} from '@/lib/onboardingApprovalRules'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasPayments, landlordHasVendorMarketplace } from '@shared/landlordCapabilities'
import { landlordPortfolioLabel } from '@shared/landlordPortfolioLabel'
import { OnboardingUloNumberCard } from '@/components/onboarding/OnboardingUloNumberCard'
import { NoVendorsContinueModal } from '@/components/onboarding/NoVendorsContinueModal'
import { OnboardingSendSwitch } from '@/components/onboarding/OnboardingSendSwitch'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'

function formatResidentReviewValue(resident: OnboardingResident): string {
  const parts: string[] = [resident.fullName]
  if (resident.unit) parts.push(`Unit ${resident.unit}`)
  parts.push(onboardingOccupancyStatusLabel(resident.occupancyStatus))
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
  if (resident.maintenanceResponsibilitiesClause?.trim()) {
    parts.push('Maintenance clause on file')
  }
  return parts.join(' · ')
}

function ReviewProgressIcon({ completing = false }: { completing?: boolean }) {
  return (
    <div
      className="relative mx-auto flex size-14 items-center justify-center"
      aria-hidden
      aria-busy={completing || undefined}
    >
      <svg viewBox="0 0 56 56" fill="none" className="size-14">
        <circle cx="28" cy="28" r="24" stroke="#E5E7EB" strokeWidth="3" />
      </svg>
      <svg
        viewBox="0 0 56 56"
        fill="none"
        className={`absolute inset-0 size-14 ${completing ? 'onb-review-progress-ring' : ''}`}
      >
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

function ReviewSummaryRow({
  label,
  value,
  trailing,
}: {
  label: string
  value: ReactNode
  trailing?: ReactNode
}) {
  const display = value == null || value === '' ? '—' : value
  return (
    <div className="flex items-start justify-between gap-8 border-b border-[#eef0f3] py-4 last:border-b-0">
      <dt className="max-w-[40%] text-[15px] font-medium leading-snug text-[#374151]">{label}</dt>
      <dd className="flex max-w-[60%] flex-1 items-start justify-end gap-3">
        <span className="text-right text-[15px] leading-snug text-[#6b7280]">{display}</span>
        {trailing}
      </dd>
    </div>
  )
}

function ReviewSummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit?: () => void
  children: ReactNode
}) {
  return (
    <section className="onb-form-card sa-surface rounded-2xl border border-[#e8eaef] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-[17px] font-semibold tracking-[-0.2px] text-[#111827]">{title}</h3>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="sa-press inline-flex shrink-0 items-center gap-1.5 text-[14px] font-medium text-[#9E439F] transition-colors hover:text-[#863786]"
          >
            <EditIcon />
            Edit
          </button>
        ) : null}
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
  const manager = [property.propertyManagerName?.trim(), property.propertyManagerPhone?.trim()]
    .filter(Boolean)
    .join(' · ')
  const managerLabel = manager ? `Manager: ${manager}` : null
  return [property.name, address, unitLabel, managerLabel].filter(Boolean).join(' · ')
}

function formatVendorCategory(category: string): string {
  const value = category.trim()
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

export type OnboardingReviewStepProps = {
  loading: boolean
  saving: boolean
  reviewData: OnboardingReviewData | null
  setupPath?: OnboardingSetupPath
  completionDisabled: boolean
  completionMissing: string[]
  payoutsReady?: boolean
  /** Masked bank/card summary from Stripe Connect, e.g. "Chase •••• 6789". */
  payoutMethodLabel?: string | null
  onEditStep: (step: OnboardingStep) => void
  onResidentOnboardingChange?: (residentId: string, enabled: boolean) => void
  onVendorOnboardingChange?: (vendorId: string, enabled: boolean) => void
  onBack: () => void
  onComplete: () => void
}

export function OnboardingReviewStep({
  loading,
  saving,
  reviewData,
  setupPath = null,
  completionDisabled,
  completionMissing,
  payoutsReady = false,
  payoutMethodLabel = null,
  onEditStep,
  onResidentOnboardingChange,
  onVendorOnboardingChange,
  onBack,
  onComplete,
}: OnboardingReviewStepProps) {
  const [confirmNoVendorsOpen, setConfirmNoVendorsOpen] = useState(false)
  const noVendorsTitleId = useId()
  const companyName = reviewData?.accountSetup.companyName.trim()
  const contactName = reviewData?.accountSetup.contactName.trim()
  const portfolioLabel = landlordPortfolioLabel({ companyName, contactName })
  const headline = portfolioLabel
    ? `Ready to launch Ulo for ${portfolioLabel}?`
    : 'Ready to complete your setup?'
  const notificationPrefsOnApproval = setupPath === 'fast_track'
  const hasVendors = (reviewData?.vendors.length ?? 0) > 0

  function requestComplete() {
    if (setupPath === 'fast_track' && !hasVendors) {
      setConfirmNoVendorsOpen(true)
      return
    }
    onComplete()
  }

  return (
    <div className="mx-auto w-full max-w-[680px]">
      <div className="text-center">
        <div className="onb-review-hero-icon">
          <ReviewProgressIcon completing={saving} />
        </div>
        <h2 className="onb-review-hero-title mt-5 text-[28px] font-semibold leading-tight tracking-[-0.5px] text-[#111827] sm:text-[32px]">
          {headline}
        </h2>
        <p className="onb-review-hero-subtitle mx-auto mt-3 max-w-[540px] text-[15px] leading-relaxed text-[#6b7280]">
          If the details look good, complete setup to open your dashboard. You can go back and edit any
          section before finishing.
        </p>
      </div>

      {loading || !reviewData ? (
        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="onb-setup-spinner" role="status" aria-label="Loading setup summary" />
          <p className="onb-setup-copy text-[14px] text-[#6a7282]">Loading your setup…</p>
        </div>
      ) : (
        <div className="onb-review-stack mt-8 space-y-4">
          <ReviewSummaryCard title="Account" onEdit={() => onEditStep('account_setup')}>
            <ReviewSummaryRow label="Company" value={reviewData.accountSetup.companyName} />
            <ReviewSummaryRow label="Contact" value={reviewData.accountSetup.contactName} />
            <ReviewSummaryRow label="Support email" value={reviewData.accountSetup.email} />
            <ReviewSummaryRow label="Phone" value={reviewData.accountSetup.phone} />
            <ReviewSummaryRow
              label="Team member"
              value={
                [
                  reviewData.accountSetup.backupContactName?.trim(),
                  reviewData.accountSetup.backupContactPhone?.trim(),
                  reviewData.accountSetup.backupContactEmail?.trim(),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Not added'
              }
            />
            {!notificationPrefsOnApproval ? (
              <>
                <ReviewSummaryRow
                  label="Notification preference"
                  value={notificationPreferenceLabel(reviewData.approvalRules.notificationPreference)}
                />
                <ReviewSummaryRow
                  label="Channel preference"
                  value={notificationChannelLabel(reviewData.approvalRules.notificationChannel)}
                />
                <ReviewSummaryRow
                  label="Quiet hours"
                  value={quietHoursLabel(reviewData.approvalRules)}
                />
              </>
            ) : null}
          </ReviewSummaryCard>

          <OnboardingUloNumberCard
            smsIntakeNumber={reviewData.smsIntakeNumber}
            smsIntakeNumberDisplay={reviewData.smsIntakeNumberDisplay}
          />

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
                  value={[
                    vendor.name,
                    formatVendorCategory(vendor.category),
                    vendor.preferredEmergency ? 'Preferred emergency' : null,
                    [vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ') || null,
                  ]
                    .filter((part) => part && part !== '—')
                    .join(' · ')}
                  trailing={
                    onVendorOnboardingChange ? (
                      <OnboardingSendSwitch
                        enabled={Boolean(vendor.sendOnboardingOnComplete)}
                        disabled={!vendor.phone.trim() && !vendor.email.trim()}
                        onChange={(enabled) => onVendorOnboardingChange(vendor.id, enabled)}
                        aria-label={
                          vendor.phone.trim() || vendor.email.trim()
                            ? `Send verification invite to ${vendor.name.trim() || `vendor ${index + 1}`} when setup completes`
                            : `Add a phone or email to send onboarding to ${vendor.name.trim() || `vendor ${index + 1}`}`
                        }
                      />
                    ) : undefined
                  }
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Vendors"
                value="No vendors added yet. You can add vendors anytime."
              />
            )}
          </ReviewSummaryCard>

          <ReviewSummaryCard title="Residents">
            {reviewData.residents.length > 0 ? (
              reviewData.residents.map((resident, index) => (
                <ReviewSummaryRow
                  key={resident.id}
                  label={reviewData.residents.length > 1 ? `Resident ${index + 1}` : 'Resident'}
                  value={formatResidentReviewValue(resident)}
                  trailing={
                    onResidentOnboardingChange ? (
                      <OnboardingSendSwitch
                        enabled={Boolean(resident.sendOnboardingOnComplete)}
                        disabled={!resident.phone.trim()}
                        onChange={(enabled) =>
                          onResidentOnboardingChange(resident.id, enabled)
                        }
                        aria-label={
                          resident.phone.trim()
                            ? `Send onboarding message to ${resident.fullName} when setup completes`
                            : `Add a phone number to send onboarding to ${resident.fullName}`
                        }
                      />
                    ) : null
                  }
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Residents"
                value="No residents added yet. You can add residents anytime."
              />
            )}
          </ReviewSummaryCard>

          <ReviewSummaryCard
            title="Maintenance issues"
            onEdit={() => onEditStep(setupPath === 'fast_track' ? 'ai_review' : 'property')}
          >
            {reviewData.maintenanceIssues.length > 0 ? (
              reviewData.maintenanceIssues.map((issue, index) => (
                <ReviewSummaryRow
                  key={issue.id}
                  label={
                    reviewData.maintenanceIssues.length > 1
                      ? `Issue ${index + 1}`
                      : 'Issue'
                  }
                  value={[
                    issue.description,
                    issue.building ? issue.building : null,
                    issue.unit ? `Unit ${issue.unit}` : null,
                    issue.category || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Maintenance issues"
                value="No open issues imported. You can add work orders anytime."
              />
            )}
          </ReviewSummaryCard>

          <ReviewSummaryCard
            title="Financial records"
            onEdit={() => onEditStep(setupPath === 'fast_track' ? 'ai_review' : 'property')}
          >
            {reviewData.financialRecords.length > 0 ? (
              reviewData.financialRecords.map((record, index) => (
                <ReviewSummaryRow
                  key={record.id}
                  label={
                    reviewData.financialRecords.length > 1
                      ? `Record ${index + 1}`
                      : 'Record'
                  }
                  value={[
                    record.building || null,
                    record.unit ? `Unit ${record.unit}` : null,
                    record.recordType || null,
                    record.description,
                    record.amount || null,
                    record.period || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))
            ) : (
              <ReviewSummaryRow
                label="Financial records"
                value="No financial records imported."
              />
            )}
          </ReviewSummaryCard>

          <ReviewSummaryCard title="Maintenance approval rules" onEdit={() => onEditStep('approval')}>
            <ReviewSummaryRow
              label="Emergencies"
              value={reviewData.approvalRules.emergencyTypes
                .map((id) => emergencyTypeLabel(id))
                .join(', ')}
            />
            <ReviewSummaryRow
              label="After hours"
              value={afterHoursRuleLabel(reviewData.approvalRules.afterHoursRule)}
            />
            {setupPath !== 'fast_track' && landlordHasVendorMarketplace(getActiveLandlordId()) ? (
              <ReviewSummaryRow
                label="Marketplace"
                value={marketplacePreferenceLabel(reviewData.approvalRules.marketplacePreference)}
              />
            ) : null}
            <ReviewSummaryRow
              label="Communication style"
              value={communicationStyleLabel(reviewData.approvalRules.communicationStyle)}
            />
            {notificationPrefsOnApproval ? (
              <>
                <ReviewSummaryRow
                  label="Notification preference"
                  value={notificationPreferenceLabel(reviewData.approvalRules.notificationPreference)}
                />
                <ReviewSummaryRow
                  label="Channel preference"
                  value={notificationChannelLabel(reviewData.approvalRules.notificationChannel)}
                />
                <ReviewSummaryRow
                  label="Quiet hours"
                  value={quietHoursLabel(reviewData.approvalRules)}
                />
              </>
            ) : null}
          </ReviewSummaryCard>

          {landlordHasPayments(getActiveLandlordId()) ? (
          <ReviewSummaryCard title="Payouts" onEdit={() => onEditStep('payouts')}>
            <ReviewSummaryRow
              label="Rent payouts"
              value={
                payoutsReady
                  ? payoutMethodLabel
                    ? `Connected — ${payoutMethodLabel}`
                    : 'Connected — rent payments go to your bank account'
                  : 'Not set up yet — add when you are ready to collect rent'
              }
            />
          </ReviewSummaryCard>
          ) : null}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <OnboardingStepNav showBack onBack={onBack} saving={saving || loading}>
          <OnboardingContinueButton
            disabled={saving || loading || completionDisabled}
            onClick={requestComplete}
          >
            Complete
          </OnboardingContinueButton>
        </OnboardingStepNav>
        {completionDisabled && completionMissing.length > 0 && !loading ? (
          <p className="max-w-[480px] self-end text-right text-[13px] leading-relaxed text-[#6b7280]">
            Complete required setup: {completionMissing.join(', ')}. Use Edit on the summary cards above to
            fill in missing details.
          </p>
        ) : null}
      </div>

      {confirmNoVendorsOpen ? (
        <NoVendorsContinueModal
          titleId={noVendorsTitleId}
          saving={saving}
          onClose={() => setConfirmNoVendorsOpen(false)}
          onConfirm={() => {
            setConfirmNoVendorsOpen(false)
            onComplete()
          }}
        />
      ) : null}
    </div>
  )
}
