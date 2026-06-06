import { useEffect, useId, useMemo, useState } from 'react'

export type ActivateUnitSubmitPayload = {
  skipTenantRegistration: boolean
  tenantName: string
  tenantPhone: string
  tenantEmail: string
  moveInDate: string
}

type ActivateUnitModalProps = {
  open: boolean
  unitLabel: string
  building: string | null
  loading?: boolean
  onClose: () => void
  onSubmit: (payload: ActivateUnitSubmitPayload) => void
}

const inputClass =
  'h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828] outline-none focus:border-[#0030b5] focus:ring-1 focus:ring-[#0030b5]'

export function ActivateUnitModal({
  open,
  unitLabel,
  building,
  loading = false,
  onClose,
  onSubmit,
}: ActivateUnitModalProps) {
  const titleId = useId()
  const [skipTenantRegistration, setSkipTenantRegistration] = useState(false)
  const [tenantName, setTenantName] = useState('')
  const [tenantPhone, setTenantPhone] = useState('')
  const [tenantEmail, setTenantEmail] = useState('')
  const [moveInDate, setMoveInDate] = useState('')

  useEffect(() => {
    if (!open) {
      setSkipTenantRegistration(false)
      setTenantName('')
      setTenantPhone('')
      setTenantEmail('')
      setMoveInDate('')
    }
  }, [open])

  const formValid = useMemo(() => {
    if (skipTenantRegistration) return true
    return (
      tenantName.trim().length > 0 &&
      tenantPhone.trim().length > 0 &&
      moveInDate.trim().length > 0
    )
  }, [skipTenantRegistration, tenantName, tenantPhone, moveInDate])

  if (!open) return null

  const location = building ? `${unitLabel} — ${building}` : unitLabel

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-[18px] font-semibold text-[#101828]">
          Activate unit
        </h2>
        <p className="mt-1 text-[14px] leading-5 text-[#6a7282]">
          Register the new tenant for <strong>{location}</strong> before the unit goes live, or skip
          tenant registration if the unit should be active without a tenant on file.
        </p>

        <label className="mt-4 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={skipTenantRegistration}
            onChange={(e) => setSkipTenantRegistration(e.target.checked)}
            className="mt-1"
          />
          <span className="text-[14px] leading-5 text-[#101828]">
            Skip tenant registration (activate without tenant name, phone, or move-in date)
          </span>
        </label>

        {!skipTenantRegistration ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#4a5565]">
                Tenant name <span className="text-[#dc2626]">*</span>
              </label>
              <input
                className={inputClass}
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#4a5565]">
                Phone number <span className="text-[#dc2626]">*</span>
              </label>
              <input
                className={inputClass}
                value={tenantPhone}
                onChange={(e) => setTenantPhone(e.target.value)}
                placeholder="+1 555 0100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#4a5565]">Email</label>
              <input
                className={inputClass}
                type="email"
                value={tenantEmail}
                onChange={(e) => setTenantEmail(e.target.value)}
                placeholder="tenant@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#4a5565]">
                Move-in date <span className="text-[#dc2626]">*</span>
              </label>
              <input
                className={inputClass}
                type="date"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-9 rounded-lg px-4 text-[14px] font-medium text-[#4a5565] hover:bg-[#f3f4f6] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!formValid || loading}
            onClick={() =>
              onSubmit({
                skipTenantRegistration,
                tenantName: tenantName.trim(),
                tenantPhone: tenantPhone.trim(),
                tenantEmail: tenantEmail.trim(),
                moveInDate: moveInDate.trim(),
              })
            }
            className="h-9 rounded-lg bg-[#0030b5] px-4 text-[14px] font-medium text-white hover:bg-[#002080] disabled:opacity-50"
          >
            {loading ? 'Activating…' : 'Activate unit'}
          </button>
        </div>
      </div>
    </div>
  )
}
