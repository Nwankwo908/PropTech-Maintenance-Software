/**
 * Guided onboarding — Residents step.
 */
import type { Dispatch, SetStateAction } from 'react'
import {
  ONBOARDING_OCCUPANCY_STATUS_OPTIONS,
  normalizeOnboardingOccupancyStatus,
} from '@/lib/onboarding'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import { OnboardingSendSwitch } from '@/components/onboarding/OnboardingSendSwitch'
import {
  onboardingFieldLabelClass,
  onboardingInputClass,
  onboardingSelectClass,
} from './onboardingFieldStyles'
import {
  applyResidentFormPatch,
  createEmptyResidentForm,
  deletePersistedOnboardingResident,
  saveOnboardingResidentsStep,
  type RentDueDayChoice,
  type ResidentFormRow,
  type SaveOnboardingResidentsStepInput,
} from './onboardingResidentForm'

export type { ResidentFormRow, RentDueDayChoice }

export type OnboardingResidentUnitOption = {
  building: string
  unitLabel: string
  value: string
}

export type OnboardingResidentsStepSaveDeps = Omit<
  SaveOnboardingResidentsStepInput,
  'residentForms'
>

export type OnboardingResidentsStepProps = {
  residentForms: ResidentFormRow[]
  setResidentForms: Dispatch<SetStateAction<ResidentFormRow[]>>
  saveDeps: OnboardingResidentsStepSaveDeps
  unitOptions: OnboardingResidentUnitOption[]
  propertyNames: string[]
  multiPropertyPortfolio: boolean
  defaultBuilding?: string
  showBackButton: boolean
  saving: boolean
  editContinueLabel?: string
  onBack: () => void
}

export function OnboardingResidentsStep({
  residentForms,
  setResidentForms,
  saveDeps,
  propertyNames,
  multiPropertyPortfolio,
  defaultBuilding = '',
  showBackButton,
  saving,
  editContinueLabel,
  onBack,
}: OnboardingResidentsStepProps) {
  function updateResidentForm(id: string, patch: Partial<ResidentFormRow>) {
    setResidentForms((prev) => applyResidentFormPatch(prev, id, patch))
  }

  function addResidentForm() {
    setResidentForms((prev) => [...prev, createEmptyResidentForm(defaultBuilding)])
  }

  function removeResidentForm(id: string) {
    if (residentForms.length <= 1) return
    setResidentForms((prev) => prev.filter((row) => row.id !== id))
    deletePersistedOnboardingResident(id, {
      setError: saveDeps.setError,
      refreshCounts: saveDeps.refreshCounts,
    })
  }

  function handleContinue() {
    void saveOnboardingResidentsStep({
      residentForms,
      ...saveDeps,
    })
  }

  return (
        <section className="sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold text-[#101828]">Add residents</h2>
          <p className="mt-1 text-[14px] text-[#6a7282]">
            Residents receive maintenance updates and can report issues by text.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {residentForms.map((form, index) => (
              <div
                key={form.id}
                className="onb-form-card sa-surface rounded-[10px] border border-[#e5e7eb] p-4"
                style={{ ['--onb-stagger' as string]: index }}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[14px] font-semibold text-[#101828]">Resident {index + 1}</p>
                  <div className="flex items-center gap-3">
                    <OnboardingSendSwitch
                      enabled={Boolean(form.sendOnboardingOnComplete)}
                      disabled={!form.phone.trim()}
                      onChange={(sendOnboardingOnComplete) =>
                        updateResidentForm(form.id, { sendOnboardingOnComplete })
                      }
                      aria-label={
                        form.phone.trim()
                          ? `Send onboarding message to resident ${index + 1} when setup completes`
                          : `Add a phone number to send onboarding to resident ${index + 1}`
                      }
                    />
                    {residentForms.length > 1 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                        onClick={() => removeResidentForm(form.id)}
                        aria-label={`Remove resident ${index + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(11rem,0.85fr)]">
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Full name</span>
                      <input
                        className={onboardingInputClass}
                        value={form.fullName}
                        onChange={(e) => updateResidentForm(form.id, { fullName: e.target.value })}
                        placeholder="Jordan Lee"
                        aria-label={`Resident ${index + 1} full name`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Occupancy status</span>
                      <div className="relative">
                        <select
                          className={onboardingSelectClass}
                          value={form.occupancyStatus}
                          onChange={(e) =>
                            updateResidentForm(form.id, {
                              occupancyStatus: normalizeOnboardingOccupancyStatus(
                                e.target.value,
                              ),
                            })
                          }
                          aria-label={`Resident ${index + 1} occupancy status`}
                        >
                          {ONBOARDING_OCCUPANCY_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]"
                          aria-hidden
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="size-4">
                            <path
                              d="M6 9l6 6 6-6"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </div>
                    </label>
                  </div>
                  {multiPropertyPortfolio ? (
                    <label className="block">
                      <span className={onboardingFieldLabelClass}>Property</span>
                      <div className="relative">
                        <select
                          className={onboardingSelectClass}
                          value={form.building}
                          onChange={(e) => {
                            updateResidentForm(form.id, { building: e.target.value })
                          }}
                          aria-label={`Resident ${index + 1} property`}
                        >
                          <option value="">Select property</option>
                          {propertyNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <span
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]"
                          aria-hidden
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="size-4">
                            <path
                              d="M6 9l6 6 6-6"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </div>
                    </label>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-[minmax(5.5rem,0.55fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Unit</span>
                      <input
                        className={onboardingInputClass}
                        value={form.unit}
                        onChange={(e) =>
                          updateResidentForm(form.id, { unit: e.target.value })
                        }
                        placeholder="101"
                        aria-label={`Resident ${index + 1} unit`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Phone</span>
                      <input
                        className={onboardingInputClass}
                        value={form.phone}
                        onChange={(e) => updateResidentForm(form.id, { phone: e.target.value })}
                        placeholder="(555) 123-4567"
                        aria-label={`Resident ${index + 1} phone`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Email</span>
                      <input
                        className={onboardingInputClass}
                        type="email"
                        value={form.email}
                        onChange={(e) => updateResidentForm(form.id, { email: e.target.value })}
                        placeholder="jordan@email.com"
                        aria-label={`Resident ${index + 1} email`}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Monthly rent</span>
                      <input
                        className={onboardingInputClass}
                        inputMode="decimal"
                        value={form.monthlyRent}
                        onChange={(e) => updateResidentForm(form.id, { monthlyRent: e.target.value })}
                        placeholder="$2,850"
                        aria-label={`Resident ${index + 1} monthly rent`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Rent due day</span>
                      <div className="relative">
                        <select
                          className={onboardingSelectClass}
                          value={form.rentDueDayMode}
                          onChange={(e) => {
                            const choice = e.target.value as RentDueDayChoice
                            if (choice === '1' || choice === '5') {
                              updateResidentForm(form.id, {
                                rentDueDayMode: choice,
                                rentDueDay: choice,
                              })
                              return
                            }
                            if (choice === 'custom') {
                              const current = form.rentDueDay.trim()
                              updateResidentForm(form.id, {
                                rentDueDayMode: 'custom',
                                rentDueDay:
                                  current === '1' || current === '5' ? '' : current,
                              })
                              return
                            }
                            updateResidentForm(form.id, {
                              rentDueDayMode: '',
                              rentDueDay: '',
                            })
                          }}
                          aria-label={`Resident ${index + 1} rent due day`}
                        >
                          <option value="">Select day</option>
                          <option value="1">1st</option>
                          <option value="5">5th</option>
                          <option value="custom">Custom</option>
                        </select>
                        <span
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]"
                          aria-hidden
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="size-4">
                            <path
                              d="M6 9l6 6 6-6"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </div>
                      {form.rentDueDayMode === 'custom' ? (
                        <input
                          className={`${onboardingInputClass} mt-2`}
                          inputMode="numeric"
                          value={form.rentDueDay}
                          onChange={(e) =>
                            updateResidentForm(form.id, { rentDueDay: e.target.value })
                          }
                          placeholder="Day of month (1–31)"
                          aria-label={`Resident ${index + 1} custom rent due day`}
                        />
                      ) : null}
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Lease starts</span>
                      <input
                        className={onboardingInputClass}
                        type="date"
                        value={form.leaseStart}
                        onChange={(e) => updateResidentForm(form.id, { leaseStart: e.target.value })}
                        aria-label={`Resident ${index + 1} lease starts`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={onboardingFieldLabelClass}>Lease ends</span>
                      <input
                        className={onboardingInputClass}
                        type="date"
                        value={form.leaseEnd}
                        onChange={(e) => updateResidentForm(form.id, { leaseEnd: e.target.value })}
                        aria-label={`Resident ${index + 1} lease ends`}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className={onboardingFieldLabelClass}>Maintenance responsibilities clause</span>
                    <textarea
                      className={`${onboardingInputClass} min-h-[96px] resize-y py-2.5`}
                      value={form.maintenanceResponsibilitiesClause}
                      onChange={(e) =>
                        updateResidentForm(form.id, {
                          maintenanceResponsibilitiesClause: e.target.value,
                        })
                      }
                      placeholder="e.g. Tenant handles bulbs and filters; landlord handles HVAC, plumbing, and structural repairs."
                      aria-label={`Resident ${index + 1} maintenance responsibilities clause`}
                    />
                    <span className="mt-1 block text-[12px] leading-4 text-[#6a7282]">
                      Optional. Paste or summarize who handles what from the lease.
                    </span>
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-[10px] border border-[#186179] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
              onClick={addResidentForm}
            >
              + Add another resident
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
