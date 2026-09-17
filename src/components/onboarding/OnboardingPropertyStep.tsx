/**
 * Guided onboarding — Property step.
 */
import type { Dispatch, SetStateAction } from 'react'
import { StreetAddressAutocomplete } from '@/components/StreetAddressAutocomplete'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import {
  ONBOARDING_PROPERTY_TYPE_OPTIONS,
  onboardingFieldLabelClass,
  onboardingInputClass,
  onboardingSelectClass,
} from './onboardingFieldStyles'
import {
  applyPropertyFormPatch,
  createEmptyPropertyForm,
  mintOnboardingPropertyIdIfNeeded,
  saveOnboardingPropertyStep,
  type PropertyFormRow,
  type SaveOnboardingPropertyStepInput,
} from './onboardingPropertyForm'

export type { PropertyFormRow }
/** @deprecated Prefer PropertyFormRow from onboardingPropertyForm */
export type OnboardingPropertyFormRow = PropertyFormRow

export type OnboardingPropertyStepSaveDeps = Omit<
  SaveOnboardingPropertyStepInput,
  'propertyForms'
>

export type OnboardingPropertyStepProps = {
  propertyForms: PropertyFormRow[]
  setPropertyForms: Dispatch<SetStateAction<PropertyFormRow[]>>
  saveDeps: OnboardingPropertyStepSaveDeps
  showBackButton: boolean
  saving: boolean
  editContinueLabel?: string
  onBack: () => void
}

export function OnboardingPropertyStep({
  propertyForms,
  setPropertyForms,
  saveDeps,
  showBackButton,
  saving,
  editContinueLabel,
  onBack,
}: OnboardingPropertyStepProps) {
  function updatePropertyForm(id: string, patch: Partial<PropertyFormRow>) {
    setPropertyForms((prev) => applyPropertyFormPatch(prev, id, patch))
  }

  async function commitPropertyIdWhenNamed(form: PropertyFormRow) {
    const propertyId = await mintOnboardingPropertyIdIfNeeded(form)
    if (!propertyId || propertyId === form.id) return
    setPropertyForms((prev) =>
      prev.map((row) => (row.id === form.id ? { ...row, id: propertyId } : row)),
    )
  }

  function addPropertyForm() {
    setPropertyForms((prev) => [...prev, createEmptyPropertyForm()])
  }

  function removePropertyForm(id: string) {
    if (propertyForms.length <= 1) return
    setPropertyForms((prev) => prev.filter((row) => row.id !== id))
  }

  function handleContinue() {
    void saveOnboardingPropertyStep({
      propertyForms,
      ...saveDeps,
    })
  }

  return (
        <section className="sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold text-[#101828]">Add your properties</h2>
          <p className="mt-1 text-[14px] text-[#6a7282]">
            Tell us about the properties you manage, including city, state, and ZIP so we can match
            nearby vendors. You can always add more properties later.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            {propertyForms.map((form, index) => (
              <div
                key={form.id}
                className="onb-form-card sa-surface rounded-[10px] border border-[#e5e7eb] p-4"
                style={{ ['--onb-stagger' as string]: index }}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[14px] font-semibold text-[#101828]">Property {index + 1}</p>
                  {propertyForms.length > 1 ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                      onClick={() => removePropertyForm(form.id)}
                      aria-label={`Remove property ${index + 1}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-4">
                  <label className="block">
                    <span className={onboardingFieldLabelClass}>Property name</span>
                    <input
                      className={onboardingInputClass}
                      value={form.name}
                      onChange={(e) => updatePropertyForm(form.id, { name: e.target.value })}
                      onBlur={(event) =>
                        void commitPropertyIdWhenNamed({ ...form, name: event.target.value })
                      }
                      placeholder="Riverside Lofts"
                      aria-label={`Property ${index + 1} name`}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-[minmax(9rem,0.9fr)_minmax(0,1.8fr)_minmax(7rem,0.7fr)]">
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Type</span>
                      <div className="relative">
                        <select
                          className={onboardingSelectClass}
                          value={form.propertyType}
                          onChange={(e) => updatePropertyForm(form.id, { propertyType: e.target.value })}
                          aria-label={`Property ${index + 1} type`}
                        >
                          {ONBOARDING_PROPERTY_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
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
                    </label>
                    <div className="min-w-0">
                      <span className={onboardingFieldLabelClass}>Street address</span>
                      <StreetAddressAutocomplete
                        className={onboardingInputClass}
                        value={form.address}
                        onChange={(address) => updatePropertyForm(form.id, { address })}
                        onPlaceResolved={(parsed) =>
                          updatePropertyForm(form.id, {
                            address: parsed.street || form.address,
                            city: parsed.city || form.city,
                            state: parsed.state || form.state,
                            zipCode: parsed.zipCode || form.zipCode,
                            ...(form.name.trim() ? {} : { name: parsed.street }),
                          })
                        }
                        placeholder="123 Main St"
                        aria-label={`Property ${index + 1} street address`}
                      />
                    </div>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Total units</span>
                      <input
                        className={onboardingInputClass}
                        type="number"
                        min={1}
                        value={form.unitCount}
                        onChange={(e) => updatePropertyForm(form.id, { unitCount: e.target.value })}
                        placeholder="48"
                        aria-label={`Property ${index + 1} total units`}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>City</span>
                      <input
                        className={onboardingInputClass}
                        value={form.city}
                        onChange={(e) => updatePropertyForm(form.id, { city: e.target.value })}
                        placeholder="Newark"
                        aria-label={`Property ${index + 1} city`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>State</span>
                      <input
                        className={onboardingInputClass}
                        value={form.state}
                        onChange={(e) => updatePropertyForm(form.id, { state: e.target.value })}
                        placeholder="NJ"
                        maxLength={2}
                        aria-label={`Property ${index + 1} state`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>ZIP code</span>
                      <input
                        className={onboardingInputClass}
                        value={form.zipCode}
                        onChange={(e) => updatePropertyForm(form.id, { zipCode: e.target.value })}
                        placeholder="07102"
                        inputMode="numeric"
                        aria-label={`Property ${index + 1} ZIP code`}
                      />
                    </label>
                  </div>
                  <div>
                    <div className="mb-3 flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-medium text-[#364153]">
                        Property manager contact
                      </span>
                      <span className="text-[12px] font-medium text-[#9ca3af]">Optional</span>
                    </div>
                    <p className="mb-3 text-[13px] leading-5 text-[#6a7282]">
                      Who should we contact for day-to-day issues at this property?
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <input
                        className={onboardingInputClass}
                        value={form.propertyManagerName}
                        onChange={(e) =>
                          updatePropertyForm(form.id, { propertyManagerName: e.target.value })
                        }
                        placeholder="Property manager name"
                        aria-label={`Property ${index + 1} manager name`}
                        autoComplete="off"
                      />
                      <input
                        className={onboardingInputClass}
                        type="tel"
                        autoComplete="tel"
                        value={form.propertyManagerPhone}
                        onChange={(e) =>
                          updatePropertyForm(form.id, { propertyManagerPhone: e.target.value })
                        }
                        placeholder="Property manager number"
                        aria-label={`Property ${index + 1} manager number`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-[10px] border border-[#186179] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
              onClick={addPropertyForm}
            >
              + Add another property
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
