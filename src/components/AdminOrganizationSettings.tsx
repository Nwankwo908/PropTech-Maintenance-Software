import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  loadOrganizationSettings,
  loadOrganizationWorkspaceSummary,
  ORGANIZATION_BRAND_ACCENTS,
  ORGANIZATION_COMPLIANCE_DOCUMENTS,
  saveOrganizationSettings,
  type OrganizationDocumentStatus,
  type OrganizationSettingsForm,
  type OrganizationWorkspaceSummary,
} from '@/lib/organizationSettings'

const inputClass =
  'h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const selectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const textareaClass =
  'min-h-[96px] w-full resize-y rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const fieldLabelClass = 'mb-1.5 block text-[13px] font-medium tracking-[-0.1504px] text-[#364153]'

const sectionCardClass =
  'rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={sectionCardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
            {title}
          </h2>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function FormField({
  label,
  htmlFor,
  className = '',
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={fieldLabelClass}>
        {label}
      </label>
      {children}
    </div>
  )
}

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#6a7282]"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SettingsSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <SelectChevron />
    </div>
  )
}

function SettingsToggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-5 tracking-[-0.1504px] text-[#6a7282]">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
          checked ? 'bg-[#101828]' : 'bg-[#e5e7eb]',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

function NotificationToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const switchId = useId()
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-[#eef0f3] bg-[#f9fafb] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#364153] shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
          {icon}
        </span>
        <label htmlFor={switchId} className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
          {label}
        </label>
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
          checked ? 'bg-[#101828]' : 'bg-[#d1d5db]',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

function DocumentStatusBadge({ status }: { status: OrganizationDocumentStatus }) {
  const styles: Record<OrganizationDocumentStatus, string> = {
    valid: 'bg-[#ecfdf3] text-[#067647] border-[#abefc6]',
    expiring: 'bg-[#fffaeb] text-[#b54708] border-[#fedf89]',
    expired: 'bg-[#fef3f2] text-[#b42318] border-[#fecdca]',
  }
  const labels: Record<OrganizationDocumentStatus, string> = {
    valid: 'Valid',
    expiring: 'Expiring',
    expired: 'Expired',
  }
  return (
    <span
      className={[
        'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]',
        styles[status],
      ].join(' ')}
    >
      {labels[status]}
    </span>
  )
}

function WorkspaceStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[13px] tracking-[-0.1504px] text-[#6a7282]">{label}</span>
      <span className="text-[13px] font-semibold tracking-[-0.1504px] text-[#101828]">{value}</span>
    </div>
  )
}

function patchSettings(
  current: OrganizationSettingsForm,
  patch: Partial<OrganizationSettingsForm>,
): OrganizationSettingsForm {
  return { ...current, ...patch }
}

export function AdminOrganizationSettings() {
  const [savedSettings, setSavedSettings] = useState<OrganizationSettingsForm>(DEFAULT_ORGANIZATION_SETTINGS)
  const [draft, setDraft] = useState<OrganizationSettingsForm>(DEFAULT_ORGANIZATION_SETTINGS)
  const [workspace, setWorkspace] = useState<OrganizationWorkspaceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([loadOrganizationSettings(), loadOrganizationWorkspaceSummary()]).then(
      ([settings, summary]) => {
        if (cancelled) return
        setSavedSettings(settings)
        setDraft(settings)
        setWorkspace(summary)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const isDirty = useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draft),
    [draft, savedSettings],
  )

  const documentSummary = useMemo(() => {
    const valid = ORGANIZATION_COMPLIANCE_DOCUMENTS.filter((doc) => doc.status === 'valid').length
    const expiring = ORGANIZATION_COMPLIANCE_DOCUMENTS.filter((doc) => doc.status === 'expiring').length
    const expired = ORGANIZATION_COMPLIANCE_DOCUMENTS.filter((doc) => doc.status === 'expired').length
    return { valid, expiring, expired }
  }, [])

  function updateDraft(patch: Partial<OrganizationSettingsForm>) {
    setDraft((current) => patchSettings(current, patch))
    setSaveMessage(null)
  }

  function handleDiscard() {
    setDraft(savedSettings)
    setSaveMessage(null)
  }

  async function handleSave() {
    setSaving(true)
    setSaveMessage(null)
    try {
      await saveOrganizationSettings(draft)
      setSavedSettings(draft)
      setSaveMessage('Changes saved.')
    } catch {
      setSaveMessage('Could not save changes. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const logoInitial = draft.displayName.trim().charAt(0).toUpperCase() || 'U'

  return (
    <>
      <div className="py-6">
        <Link
          to="/admin/settings"
          className="inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#6a7282] transition-colors hover:text-[#101828]"
        >
          <span aria-hidden>←</span>
          Settings
        </Link>
        <h1 className="mt-4 text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Organization
        </h1>
        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          Company profile, branding, and time zone.
        </p>
      </div>

      {loading ? (
        <p className="text-[14px] text-[#6a7282]">Loading organization settings…</p>
      ) : (
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <SettingsSection
              title="Company profile"
              description="Basic details shown to residents and vendors."
            >
              <div className="flex flex-wrap items-center gap-4">
                <div
                  className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[24px] font-semibold text-white"
                  aria-hidden
                >
                  {logoInitial}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-[8px] border border-[#e5e7eb] bg-white px-3.5 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb]"
                  >
                    Upload logo
                  </button>
                  <button
                    type="button"
                    className="rounded-[8px] px-3.5 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282] transition-colors hover:text-[#101828]"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <FormField label="Legal name" htmlFor="org-legal-name" className="sm:col-span-2">
                  <input
                    id="org-legal-name"
                    className={inputClass}
                    value={draft.legalName}
                    onChange={(e) => updateDraft({ legalName: e.target.value })}
                  />
                </FormField>
                <FormField label="Display name" htmlFor="org-display-name">
                  <input
                    id="org-display-name"
                    className={inputClass}
                    value={draft.displayName}
                    onChange={(e) => updateDraft({ displayName: e.target.value })}
                  />
                </FormField>
                <FormField label="Support email" htmlFor="org-support-email">
                  <input
                    id="org-support-email"
                    type="email"
                    className={inputClass}
                    value={draft.supportEmail}
                    onChange={(e) => updateDraft({ supportEmail: e.target.value })}
                  />
                </FormField>
                <FormField label="Phone" htmlFor="org-phone">
                  <input
                    id="org-phone"
                    className={inputClass}
                    value={draft.phone}
                    onChange={(e) => updateDraft({ phone: e.target.value })}
                  />
                </FormField>
                <FormField label="About" htmlFor="org-about" className="sm:col-span-2">
                  <textarea
                    id="org-about"
                    className={textareaClass}
                    value={draft.about}
                    onChange={(e) => updateDraft({ about: e.target.value })}
                  />
                </FormField>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Registered address"
              description="Used for invoices, contracts, and tax reporting."
            >
              <div className="grid gap-4 sm:grid-cols-6">
                <FormField label="Street" htmlFor="org-street" className="sm:col-span-6">
                  <input
                    id="org-street"
                    className={inputClass}
                    value={draft.street}
                    onChange={(e) => updateDraft({ street: e.target.value })}
                  />
                </FormField>
                <FormField label="City" htmlFor="org-city" className="sm:col-span-2">
                  <input
                    id="org-city"
                    className={inputClass}
                    value={draft.city}
                    onChange={(e) => updateDraft({ city: e.target.value })}
                  />
                </FormField>
                <FormField label="State" htmlFor="org-state" className="sm:col-span-2">
                  <input
                    id="org-state"
                    className={inputClass}
                    value={draft.state}
                    onChange={(e) => updateDraft({ state: e.target.value })}
                  />
                </FormField>
                <FormField label="ZIP" htmlFor="org-zip" className="sm:col-span-2">
                  <input
                    id="org-zip"
                    className={inputClass}
                    value={draft.zip}
                    onChange={(e) => updateDraft({ zip: e.target.value })}
                  />
                </FormField>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Regional preferences"
              description="Applied across dashboards, reports, and resident communications."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Time zone" htmlFor="org-timezone">
                  <SettingsSelect
                    id="org-timezone"
                    value={draft.timeZone}
                    onChange={(timeZone) => updateDraft({ timeZone })}
                    options={[
                      { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
                      { value: 'America/Denver', label: 'America/Denver' },
                      { value: 'America/Chicago', label: 'America/Chicago' },
                      { value: 'America/New_York', label: 'America/New_York' },
                    ]}
                  />
                </FormField>
                <FormField label="Currency" htmlFor="org-currency">
                  <SettingsSelect
                    id="org-currency"
                    value={draft.currency}
                    onChange={(currency) => updateDraft({ currency })}
                    options={[
                      { value: 'USD', label: 'USD' },
                      { value: 'CAD', label: 'CAD' },
                    ]}
                  />
                </FormField>
                <FormField label="Date format" htmlFor="org-date-format">
                  <SettingsSelect
                    id="org-date-format"
                    value={draft.dateFormat}
                    onChange={(dateFormat) => updateDraft({ dateFormat })}
                    options={[
                      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                    ]}
                  />
                </FormField>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Brand accent"
              description="Personalize the resident portal and email templates."
            >
              <div className="flex flex-wrap gap-3">
                {ORGANIZATION_BRAND_ACCENTS.map((accent) => {
                  const selected = draft.brandAccent === accent.color
                  return (
                    <button
                      key={accent.id}
                      type="button"
                      aria-label={accent.label}
                      aria-pressed={selected}
                      onClick={() => updateDraft({ brandAccent: accent.color })}
                      className={[
                        'relative flex size-10 items-center justify-center rounded-full transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
                        selected ? 'scale-105 ring-2 ring-[#155dfc] ring-offset-2' : '',
                      ].join(' ')}
                      style={{ backgroundColor: accent.color }}
                    >
                      {selected ? (
                        <svg className="size-4 text-white" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path
                            d="M3.5 8.5L6.5 11.5L12.5 4.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </SettingsSection>

            <SettingsSection
              title="Organization preferences"
              description="Operational defaults applied across properties, vendors, and residents."
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">Maintenance</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <FormField label="Auto-approval limit" htmlFor="org-auto-approval">
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-[#6a7282]">
                      $
                    </span>
                    <input
                      id="org-auto-approval"
                      className={`${inputClass} pl-7`}
                      value={draft.autoApprovalLimit}
                      onChange={(e) => updateDraft({ autoApprovalLimit: e.target.value })}
                    />
                  </div>
                </FormField>
                <FormField label="Escalation threshold" htmlFor="org-escalation">
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-[#6a7282]">
                      $
                    </span>
                    <input
                      id="org-escalation"
                      className={`${inputClass} pl-7`}
                      value={draft.escalationThreshold}
                      onChange={(e) => updateDraft({ escalationThreshold: e.target.value })}
                    />
                  </div>
                </FormField>
                <FormField label="Default response SLA" htmlFor="org-sla">
                  <SettingsSelect
                    id="org-sla"
                    value={draft.defaultResponseSla}
                    onChange={(defaultResponseSla) => updateDraft({ defaultResponseSla })}
                    options={[
                      { value: '2 hours', label: '2 hours' },
                      { value: '4 hours', label: '4 hours' },
                      { value: '8 hours', label: '8 hours' },
                      { value: '24 hours', label: '24 hours' },
                    ]}
                  />
                </FormField>
                <FormField label="Preferred vendor pool" htmlFor="org-vendor-pool">
                  <SettingsSelect
                    id="org-vendor-pool"
                    value={draft.preferredVendorPool}
                    onChange={(preferredVendorPool) => updateDraft({ preferredVendorPool })}
                    options={[
                      { value: 'Tier 1 — Certified', label: 'Tier 1 — Certified' },
                      { value: 'Tier 2 — Preferred', label: 'Tier 2 — Preferred' },
                      { value: 'All active vendors', label: 'All active vendors' },
                    ]}
                  />
                </FormField>
              </div>

              <div className="mt-5 space-y-4 border-t border-[#eef0f3] pt-5">
                <SettingsToggle
                  id="org-photo-evidence"
                  checked={draft.requirePhotoEvidence}
                  onChange={(requirePhotoEvidence) => updateDraft({ requirePhotoEvidence })}
                  label="Require photo evidence on close-out"
                />
                <SettingsToggle
                  id="org-ai-dispatch"
                  checked={draft.allowAiDispatch}
                  onChange={(allowAiDispatch) => updateDraft({ allowAiDispatch })}
                  label="Allow AI to dispatch routine requests"
                />
              </div>

              <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">
                Resident notifications
              </p>
              <div className="mt-3 space-y-3">
                <NotificationToggleRow
                  icon={
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M2.5 4.5H13.5M2.5 8H13.5M2.5 11.5H9"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  }
                  label="Email updates"
                  checked={draft.emailUpdates}
                  onChange={(emailUpdates) => updateDraft({ emailUpdates })}
                />
                <NotificationToggleRow
                  icon={
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3.5 2.5H12.5L11 9.5C10.7 11.1 9.2 12.2 7.5 12.2C5.8 12.2 4.3 11.1 4 9.5L2.5 2.5Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  label="SMS alerts"
                  checked={draft.smsAlerts}
                  onChange={(smsAlerts) => updateDraft({ smsAlerts })}
                />
                <NotificationToggleRow
                  icon={
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 3.5V8L10.5 10.5M13.5 8C13.5 11.0376 11.0376 13.5 8 13.5C4.96243 13.5 2.5 11.0376 2.5 8C2.5 4.96243 4.96243 2.5 8 2.5C11.0376 2.5 13.5 4.96243 13.5 8Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  }
                  label="Push notifications"
                  checked={draft.pushNotifications}
                  onChange={(pushNotifications) => updateDraft({ pushNotifications })}
                />
                <NotificationToggleRow
                  icon={
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 2.5V4M4.5 4.5L5.6 5.6M11.5 4.5L10.4 5.6M3.5 8H2.5M13.5 8H12.5M4.5 11.5L5.6 10.4M11.5 11.5L10.4 10.4M8 12.5V13.5"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  }
                  label="Quiet hours"
                  checked={draft.quietHours}
                  onChange={(quietHours) => updateDraft({ quietHours })}
                />
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <FormField label="Rent reminder cadence" htmlFor="org-rent-cadence">
                  <SettingsSelect
                    id="org-rent-cadence"
                    value={draft.rentReminderCadence}
                    onChange={(rentReminderCadence) => updateDraft({ rentReminderCadence })}
                    options={[
                      { value: '2, 5, 1 day before', label: '2, 5, 1 day before' },
                      { value: '3, 1 day before', label: '3, 1 day before' },
                      { value: '1 day before', label: '1 day before' },
                    ]}
                  />
                </FormField>
                <FormField label="Preferred language" htmlFor="org-language">
                  <SettingsSelect
                    id="org-language"
                    value={draft.preferredLanguage}
                    onChange={(preferredLanguage) => updateDraft({ preferredLanguage })}
                    options={[
                      { value: 'English (US)', label: 'English (US)' },
                      { value: 'Spanish (US)', label: 'Spanish (US)' },
                    ]}
                  />
                </FormField>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Compliance & business documents"
              description="Store incorporation, insurance, and licensing files in one place."
              action={
                <button
                  type="button"
                  className="rounded-[8px] border border-[#e5e7eb] bg-white px-3.5 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb]"
                >
                  Upload document
                </button>
              }
            >
              <div className="overflow-hidden rounded-[10px] border border-[#eef0f3]">
                {ORGANIZATION_COMPLIANCE_DOCUMENTS.map((document, index) => (
                  <div
                    key={document.id}
                    className={[
                      'flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap',
                      index > 0 ? 'border-t border-[#eef0f3]' : '',
                    ].join(' ')}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#364153]">
                        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path
                            d="M4.5 2.5H9.5L12.5 5.5V13.5H4.5V2.5Z"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinejoin="round"
                          />
                          <path d="M9.5 2.5V5.5H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                          {document.name}
                        </p>
                        <p className="text-[12px] tracking-[-0.1504px] text-[#6a7282]">
                          {document.meta} · {document.updatedLabel}
                        </p>
                      </div>
                    </div>
                    <DocumentStatusBadge status={document.status} />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Download ${document.name}`}
                        className="rounded-[8px] p-2 text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#101828]"
                      >
                        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path
                            d="M8 3.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8M3.5 12.5H12.5"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label={`More actions for ${document.name}`}
                        className="rounded-[8px] p-2 text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#101828]"
                      >
                        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <circle cx="8" cy="4" r="1" fill="currentColor" />
                          <circle cx="8" cy="8" r="1" fill="currentColor" />
                          <circle cx="8" cy="12" r="1" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                  {documentSummary.valid} valid · {documentSummary.expiring} expiring · {documentSummary.expired}{' '}
                  expired
                </p>
                <button
                  type="button"
                  className="text-[13px] font-medium tracking-[-0.1504px] text-[#155dfc] transition-colors hover:text-[#0030b5]"
                >
                  View archive →
                </button>
              </div>
            </SettingsSection>
          </div>

          <aside className="w-full shrink-0 xl:sticky xl:top-6 xl:w-[280px]">
            <div className={sectionCardClass}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">Workspace</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex rounded-full bg-[#101828] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-white">
                  {workspace?.planLabel ?? 'Enterprise'}
                </span>
              </div>

              <div className="mt-4 divide-y divide-[#eef0f3]">
                <WorkspaceStat label="Properties" value={workspace?.propertyCount ?? '—'} />
                <WorkspaceStat label="Active units" value={workspace?.activeUnitCount ?? '—'} />
                <WorkspaceStat label="Team members" value={workspace?.teamMemberCount ?? '—'} />
                <WorkspaceStat label="Created" value={workspace?.createdLabel ?? '—'} />
                <WorkspaceStat label="Workspace ID" value={workspace?.workspaceId ?? '—'} />
              </div>

              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  disabled={!isDirty || saving}
                  onClick={() => void handleSave()}
                  className="h-10 w-full rounded-[10px] bg-[#101828] text-[14px] font-medium tracking-[-0.1504px] text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  disabled={!isDirty || saving}
                  onClick={handleDiscard}
                  className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white text-[14px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Discard
                </button>
              </div>

              <p className="mt-4 text-[12px] leading-4 tracking-[-0.1504px] text-[#6a7282]">
                Changes apply to all team members instantly.
              </p>
              {saveMessage ? (
                <p className="mt-2 text-[12px] font-medium tracking-[-0.1504px] text-[#067647]">{saveMessage}</p>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
