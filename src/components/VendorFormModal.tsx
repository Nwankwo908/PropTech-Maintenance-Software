import { useEffect, useId, useState } from 'react'
import { inviteVendorAfterAdd, vendorInviteWarningMessage } from '@/api/vendorVerification'
import { syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import maintenanceVendorRailIcon from '@/assets/Maintenance_Vendor_2.svg'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'
import {
  dbCategoryToVendorTrade,
  isVendorTradeSlug,
  normalizeVendorTrade,
  VENDOR_TRADE_OPTIONS,
  vendorTradeToDbCategory,
} from '@/lib/vendorTrades'

export type VendorNotificationChannel = 'email' | 'sms' | 'both'

export type VendorManagementRow = {
  id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  notification_channel: VendorNotificationChannel
  active: boolean
  portal_api_key: string | null
}

/**
 * Postgres stores normalized trade slugs (`vendors.category`).
 * Taxonomy: `@/lib/vendorTrades`.
 */
const VENDOR_SPECIALTY_OPTIONS = VENDOR_TRADE_OPTIONS.map((trade) => ({
  formValue: trade.value,
  label: trade.label,
  dbCategory: trade.value as string,
}))

const VENDOR_FORM_VALUE_SET = new Set(VENDOR_SPECIALTY_OPTIONS.map((o) => o.formValue))

function normalizeVendorCategoryForForm(raw: string | null | undefined): string {
  return dbCategoryToVendorTrade(raw) || 'other'
}

function resolveVendorCategoryPayload(categorySelect: string):
  | { ok: true; payload: string | null }
  | { ok: false; message: string } {
  const catRaw = categorySelect.trim()
  if (!catRaw) return { ok: false, message: 'Specialty is required.' }
  if (!isVendorTradeSlug(catRaw) && !VENDOR_FORM_VALUE_SET.has(catRaw as never)) {
    const normalized = vendorTradeToDbCategory(catRaw)
    if (!normalized) {
      return { ok: false, message: 'Please select a valid specialty from the list.' }
    }
    return { ok: true, payload: normalized }
  }
  return { ok: true, payload: vendorTradeToDbCategory(catRaw) }
}

function IconChevronDown({ className = 'size-4 text-[#0a0a0a]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

const vendorFormInputClass =
  'sa-surface h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30'

const vendorFormSelectClass =
  'sa-surface h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:border-[#0030b5]/45 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#0030b5]/30'

export function VendorFormModal({
  open,
  mode,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: 'add' | 'edit'
  initial: VendorManagementRow | null
  onClose: () => void
  /** Optional invite warning when roster save succeeded but verification invite failed. */
  onSaved: (meta?: { inviteWarning?: string }) => void
}) {
  const titleId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notificationChannel, setNotificationChannel] =
    useState<VendorNotificationChannel>('email')
  const [category, setCategory] = useState('')
  const [active, setActive] = useState(true)
  const [contactName, setContactName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setCategory(normalizeVendorCategoryForForm(initial.category))
      setEmail(initial.email ?? '')
      setPhone(initial.phone ?? '')
      setNotificationChannel(mode === 'edit' && initial.notification_channel === 'both' ? 'email' : initial.notification_channel)
      setActive(initial.active)
      setContactName('')
    } else {
      setName('')
      setCategory('')
      setEmail('')
      setPhone('')
      setNotificationChannel('email')
      setActive(true)
      setContactName('')
    }
    setSaveError(null)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit() {
    const n = name.trim()
    if (!n) {
      setSaveError('Name is required.')
      return
    }
    const categoryResolved = resolveVendorCategoryPayload(category)
    if (!categoryResolved.ok) {
      setSaveError(categoryResolved.message)
      return
    }
    const categoryPayload = categoryResolved.payload
    if (!supabase) {
      setSaveError('Supabase is not configured.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const emailPayload = email.trim() || null
      const phonePayload = phone.trim() || null
      if (mode === 'add') {
        console.log('[vendor-form] submit (add)', {
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
        })
        const { data, error } = await supabase
          .from('vendors')
          .insert({
            name: n,
            category: categoryPayload,
            email: emailPayload,
            phone: phonePayload,
            notification_channel: notificationChannel,
            active,
            landlord_id: getActiveLandlordId(),
          })
          .select('id')
          .single()
        if (error) throw error
        if (phonePayload && data?.id) {
          void syncSmsIdentity({
            phone: phonePayload,
            identityType: 'vendor',
            vendorId: data.id,
          })
        }
        let inviteWarning: string | undefined
        if (data?.id && (phonePayload || emailPayload)) {
          const trade = normalizeVendorTrade(categoryPayload, { fallbackOther: false })
          const invite = await inviteVendorAfterAdd({
            landlordId: getActiveLandlordId(),
            vendorId: data.id,
            businessName: n,
            contactName: contactName.trim() || null,
            email: emailPayload,
            phone: phonePayload,
            tradeCategories: trade ? [trade] : undefined,
          })
          inviteWarning = vendorInviteWarningMessage(invite) ?? undefined
        }
        onSaved(inviteWarning ? { inviteWarning } : undefined)
        return
      } else if (initial) {
        console.log('[vendor-form] submit (update)', {
          id: initial.id,
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
        })
        const { error } = await supabase
          .from('vendors')
          .update({
            name: n,
            category: categoryPayload,
            email: emailPayload,
            phone: phonePayload,
            notification_channel: notificationChannel,
            active,
          })
          .eq('id', initial.id)
        if (error) throw error
        if (phonePayload) {
          void syncSmsIdentity({
            phone: phonePayload,
            identityType: 'vendor',
            vendorId: initial.id,
          })
        }
      }
      onSaved()
    } catch (e) {
      setSaveError(getErrorMessage(e, "Couldn't save this vendor. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  const emailSelected = notificationChannel === 'email' || notificationChannel === 'both'
  const smsSelected = notificationChannel === 'sms' || notificationChannel === 'both'

  function toggleEmailChannel() {
    if (emailSelected && smsSelected) {
      setNotificationChannel('sms')
      return
    }
    if (emailSelected) return
    setNotificationChannel(smsSelected ? 'both' : 'email')
  }

  function toggleSmsChannel() {
    if (smsSelected && emailSelected) {
      setNotificationChannel('email')
      return
    }
    if (smsSelected) return
    setNotificationChannel(emailSelected ? 'both' : 'sms')
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="sa-scrim absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sa-rail relative flex h-full max-h-dvh w-full max-w-[min(100vw,672px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <img src={maintenanceVendorRailIcon} alt="" aria-hidden className="size-5 shrink-0" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                {mode === 'add' ? 'Add New Vendor' : 'Edit Vendor'}
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                {mode === 'add' ? 'Register a new service provider' : initial?.name ?? 'Update vendor details'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-[#e2f4ed] hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6">
          <div className="flex flex-col gap-4 pb-6">
            {saveError ? (
              <p className="rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 py-2 text-[13px] text-[#b52a00]">
                {saveError}
              </p>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="vendor-form-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Company Name <span className="text-[#b52a00]">*</span>
              </label>
              <input
                id="vendor-form-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={vendorFormInputClass}
                autoComplete="organization"
                placeholder="e.g., QuickFix Plumbing"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="vendor-form-contact-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Contact Name <span className="text-[#b52a00]">*</span>
              </label>
              <input
                id="vendor-form-contact-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={vendorFormInputClass}
                placeholder="e.g., John Smith"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="vendor-form-email" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Email Address <span className="text-[#b52a00]">*</span>
                </label>
                <input
                  id="vendor-form-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={vendorFormInputClass}
                  placeholder="e.g., contact@company.com"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="vendor-form-phone" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Phone Number <span className="text-[#b52a00]">*</span>
                </label>
                <input
                  id="vendor-form-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={vendorFormInputClass}
                  placeholder="e.g., (555) 123-4567"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="vendor-form-category" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Specialty <span className="text-[#b52a00]">*</span>
              </label>
              <div className="relative">
                <select
                  id="vendor-form-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={vendorFormSelectClass}
                >
                  <option value="">Select a specialty</option>
                  {VENDOR_SPECIALTY_OPTIONS.map((option) => (
                    <option key={option.formValue} value={option.formValue}>
                      {option.label}
                    </option>
                  ))}
                  {category && !VENDOR_FORM_VALUE_SET.has(category as never) ? (
                    <option value={category}>{category} (invalid — choose a listed specialty)</option>
                  ) : null}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Delivery Channel <span className="text-[#b52a00]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={toggleEmailChannel}
                    className={[
                      'sa-card rounded-[10px] border-2 px-[18px] pb-[10px] pt-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2',
                      emailSelected
                        ? 'border-[#186179] bg-[#e8f2f5]'
                        : 'border-[#e5e7eb] bg-white hover:bg-[#f9fafb]',
                    ].join(' ')}
                    aria-pressed={emailSelected}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={[
                          'inline-flex size-4 items-center justify-center rounded-[4px] border text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]',
                          emailSelected
                            ? 'border-[#611879] bg-[#611879]'
                            : 'border-black/10 bg-[#f3f3f5]',
                        ].join(' ')}
                        aria-hidden
                      >
                        {emailSelected ? (
                          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span>
                        <span className="block text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">Email</span>
                        <span className="block text-[12px] leading-4 text-[#6a7282]">Standard delivery, can be combined</span>
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={toggleSmsChannel}
                    className={[
                      'sa-card rounded-[10px] border-2 px-[18px] pb-[10px] pt-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2',
                      smsSelected
                        ? 'border-[#186179] bg-[#e8f2f5]'
                        : 'border-[#e5e7eb] bg-white hover:bg-[#f9fafb]',
                    ].join(' ')}
                    aria-pressed={smsSelected}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={[
                          'inline-flex size-4 items-center justify-center rounded-[4px] border text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]',
                          smsSelected
                            ? 'border-[#611879] bg-[#611879]'
                            : 'border-black/10 bg-[#f3f3f5]',
                        ].join(' ')}
                        aria-hidden
                      >
                        {smsSelected ? (
                          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span>
                        <span className="block text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">SMS</span>
                        <span className="block text-[12px] leading-4 text-[#6a7282]">Immediate delivery</span>
                      </span>
                    </div>
                  </button>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Status
              </p>
              <div className="flex w-full rounded-[10px] border border-[#e5e7eb] bg-[#f3f3f5] p-1">
                <button
                  type="button"
                  onClick={() => setActive(true)}
                  className={[
                    'sa-pill h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
                    active ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setActive(false)}
                  className={[
                    'sa-pill h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
                    !active ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={!active}
                >
                  Inactive
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void submit()}
            className="sa-press inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-transparent px-4 text-[14px] font-medium text-[#186179] outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'add' ? 'Add Vendor' : 'Save Changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
