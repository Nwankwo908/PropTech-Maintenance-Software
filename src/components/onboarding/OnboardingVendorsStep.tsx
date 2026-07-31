/**
 * Guided onboarding — Vendors step.
 */
import type { Dispatch, SetStateAction } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { VENDOR_TRADE_OPTIONS as CANONICAL_VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import {
  onboardingInputClass,
  onboardingSelectClass,
} from './onboardingFieldStyles'
import {
  applyVendorFormPatch,
  createEmptyVendorForm,
  deletePersistedOnboardingVendor,
  saveOnboardingVendorsStep,
  type SaveOnboardingVendorsStepInput,
  type VendorFormRow,
} from './onboardingVendorForm'

const VENDOR_TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Select trade' },
  ...CANONICAL_VENDOR_TRADE_OPTIONS.map((trade) => ({
    value: trade.value,
    label: trade.label,
  })),
]

export type { VendorFormRow }
/** @deprecated Prefer VendorFormRow from onboardingVendorForm */
export type OnboardingVendorFormRow = VendorFormRow

export type OnboardingVendorsStepSaveDeps = Omit<
  SaveOnboardingVendorsStepInput,
  'vendorForms'
>

export type OnboardingVendorsStepProps = {
  vendorForms: VendorFormRow[]
  setVendorForms: Dispatch<SetStateAction<VendorFormRow[]>>
  saveDeps: OnboardingVendorsStepSaveDeps
  showBackButton: boolean
  saving: boolean
  editContinueLabel?: string
  onBack: () => void
}

export function OnboardingVendorsStep({
  vendorForms,
  setVendorForms,
  saveDeps,
  showBackButton,
  saving,
  editContinueLabel,
  onBack,
}: OnboardingVendorsStepProps) {
  function updateVendorForm(id: string, patch: Partial<VendorFormRow>) {
    setVendorForms((prev) => applyVendorFormPatch(prev, id, patch))
  }

  function addVendorForm() {
    setVendorForms((prev) => [...prev, createEmptyVendorForm()])
  }

  function removeVendorForm(id: string) {
    if (vendorForms.length <= 1) return
    setVendorForms((prev) => prev.filter((row) => row.id !== id))
    deletePersistedOnboardingVendor(id, {
      setError: saveDeps.setError,
      refreshCounts: saveDeps.refreshCounts,
    })
  }

  function handleContinue() {
    void saveOnboardingVendorsStep({
      vendorForms,
      ...saveDeps,
    })
  }

  return (
        <section className="sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold text-[#101828]">Add vendors</h2>
          <p className="mt-1 text-[14px] text-[#6a7282]">
          Tell us about the vendors you work with for repairs, maintenance, and property services.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {vendorForms.map((form, index) => (
              <div
                key={form.id}
                className="onb-form-card sa-surface rounded-[10px] border border-[#e5e7eb] p-4"
                style={{ ['--onb-stagger' as string]: index }}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[14px] font-semibold text-[#101828]">Vendor {index + 1}</p>
                  {vendorForms.length > 1 ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                      onClick={() => removeVendorForm(form.id)}
                      aria-label={`Remove vendor ${index + 1}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    className={`${onboardingInputClass} sm:col-span-2`}
                    value={form.name}
                    onChange={(e) => updateVendorForm(form.id, { name: e.target.value })}
                    placeholder="Vendor name"
                    aria-label={`Vendor ${index + 1} name`}
                  />
                  <div className="relative">
                    <select
                      className={`${onboardingSelectClass} ${!form.category ? 'text-[#9ca3af]' : ''}`}
                      value={form.category}
                      onChange={(e) => updateVendorForm(form.id, { category: e.target.value })}
                      aria-label={`Vendor ${index + 1} trade`}
                    >
                      {VENDOR_TRADE_OPTIONS.map((option) => (
                        <option key={option.value || 'placeholder'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" className="size-4">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                      </svg>
                    </span>
                  </div>
                  <input
                    className={onboardingInputClass}
                    value={form.phone}
                    onChange={(e) => updateVendorForm(form.id, { phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    aria-label={`Vendor ${index + 1} phone`}
                  />
                  <input
                    className={`${onboardingInputClass} sm:col-span-2`}
                    type="email"
                    value={form.email}
                    onChange={(e) => updateVendorForm(form.id, { email: e.target.value })}
                    placeholder="Email"
                    aria-label={`Vendor ${index + 1} email`}
                  />
                  <label className="flex cursor-pointer items-center gap-3 sm:col-span-2">
                    <input
                      type="checkbox"
                      className={checkboxInputClassName}
                      checked={form.preferredEmergency}
                      onChange={(e) =>
                        updateVendorForm(form.id, { preferredEmergency: e.target.checked })
                      }
                      aria-label={`Vendor ${index + 1} preferred emergency vendor`}
                    />
                    <span className="text-[14px] font-medium text-[#101828]">
                      Preferred emergency vendor
                    </span>
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
              onClick={addVendorForm}
            >
              + Add another vendor
            </button>
          </div>
          <OnboardingStepNav
            showBack={showBackButton}
            onBack={onBack}
            saving={saving}
          >
            <OnboardingContinueButton disabled={saving} onClick={handleContinue}>
              {editContinueLabel ?? 'Continue'}
            </OnboardingContinueButton>
          </OnboardingStepNav>
        </section>
  )
}
