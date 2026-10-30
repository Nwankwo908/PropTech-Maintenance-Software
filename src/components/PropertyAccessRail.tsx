import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import propertyAccessIcon from '@/assets/noun_propertykey_8436012.svg'
import {
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { loadPropertySetupGapCounts, notifyPropertyDetailsChanged } from '@/lib/propertyDetailsCompleteness'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  EMPTY_PROPERTY_ACCESS,
  loadPropertyAccess,
  propertyAccessHasContent,
  propertyAccessRemainingNotice,
  savePropertyAccess,
  type PropertyAccessProfile,
} from '@/lib/propertyAccess'

const ACCESS_FIELDS: Array<{
  key: keyof Omit<PropertyAccessProfile, 'updatedAt'>
  label: string
  placeholder: string
}> = [
  {
    key: 'buildingEntry',
    label: 'Building Entry Instructions',
    placeholder: 'Enter entry instructions',
  },
  { key: 'gateCode', label: 'Gate Code', placeholder: 'Enter gate code' },
  {
    key: 'lockboxLocation',
    label: 'Lockbox Location',
    placeholder: 'Enter lockbox location',
  },
  {
    key: 'lockboxCode',
    label: 'Lockbox Code',
    placeholder: 'Enter lockbox code',
  },
  {
    key: 'utilityRoomAccess',
    label: 'Utility Room Access',
    placeholder: 'Enter utility room access',
  },
  {
    key: 'visitorParking',
    label: 'Visitor Parking Instructions',
    placeholder: 'Enter visitor parking instructions',
  },
  {
    key: 'superintendentContact',
    label: 'Superintendent Contact',
    placeholder: 'Enter superintendent contact',
  },
  {
    key: 'emergencyAccessNotes',
    label: 'Emergency Access Notes',
    placeholder: 'Enter emergency access notes',
  },
]

function AccessField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-semibold leading-normal text-[#475569]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 rounded-[6px] border border-solid border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] leading-normal text-[#0d0f11] outline-none placeholder:text-[#64748b] focus:border-[#94a3b8]"
      />
    </label>
  )
}

function CloseRailIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

export function PropertyAccessRail({
  open,
  building,
  onClose,
}: {
  open: boolean
  building: string
  onClose: () => void
}) {
  const titleId = useId()
  const [access, setAccess] = useState<PropertyAccessProfile>({ ...EMPTY_PROPERTY_ACCESS })
  const [hadSaved, setHadSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [propertiesLeft, setPropertiesLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !building.trim()) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSaved(false)
    setPropertiesLeft(null)
    void loadPropertyAccess(building).then((loaded) => {
      if (cancelled) return
      setAccess({ ...loaded, updatedAt: null })
      setHadSaved(Boolean(loaded.updatedAt) || propertyAccessHasContent(loaded))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, building])

  if (!open || typeof document === 'undefined') return null

  const canSave = !loading && !saving && Boolean(access.lockboxCode.trim())

  return createPortal(
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined)}
      >
        <header className="sa-enter relative shrink-0 border-b border-[#e5e7eb] px-5 py-4 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={propertyAccessIcon}
              alt=""
              className="size-8 shrink-0 object-contain"
              aria-hidden
            />
            <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              {hadSaved ? 'Edit property access' : 'Add property access'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseRailIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {loading ? (
            <p className="py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
          ) : saved ? (
            <div role="status" className="rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-4">
              <p className="text-[14px] font-semibold leading-5 text-[#166534]">
                Your property access details were saved.
              </p>
              {propertiesLeft != null ? (
                <p className="mt-1 text-[13px] leading-5 text-[#166534]">
                  {propertyAccessRemainingNotice(propertiesLeft)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {ACCESS_FIELDS.map((field) => (
                <AccessField
                  key={field.key}
                  label={field.label}
                  value={access[field.key]}
                  placeholder={field.placeholder}
                  onChange={(value) => setAccess((prev) => ({ ...prev, [field.key]: value }))}
                />
              ))}
              {error ? <p className="text-[12px] text-[#b91c1c]">{error}</p> : null}
            </div>
          )}
        </div>

        <footer className={ADMIN_RAIL_FOOTER_CLASS}>
          {saved ? (
            <button type="button" onClick={onClose} className={ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS}>
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                className={ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS}
                onClick={() => {
                  if (!access.lockboxCode.trim()) {
                    setError('Lockbox code is required.')
                    return
                  }
                  void (async () => {
                    setSaving(true)
                    setError(null)
                    try {
                      await savePropertyAccess(building, {
                        ...access,
                        updatedAt: new Date().toISOString(),
                      })
                      notifyPropertyDetailsChanged(building)
                      setSaved(true)
                      try {
                        const listed = await listPropertiesForLandlord(getActiveLandlordId())
                        if (listed.ok) {
                          const gaps = await loadPropertySetupGapCounts(listed.properties)
                          setPropertiesLeft(gaps.missingAccess)
                        }
                      } catch {
                        // The save already succeeded. Leave the remaining count blank.
                      }
                    } catch (err) {
                      setError(getErrorMessage(err, 'Could not save property access.'))
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
              >
                {saving ? 'Saving…' : 'Save Details'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
