import { useEffect, useId, useState } from 'react'
import { syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { phoneForDbOrError } from '@/lib/phoneFormat'
import { supabase } from '@/lib/supabase'
import { emptyToNull } from '@/lib/vendorLocation'
import {
  dbCategoryToVendorTrade,
  isVendorTradeSlug,
  VENDOR_TRADE_OPTIONS,
  vendorTradeToDbCategory,
} from '@/lib/vendorTrades'

export type VendorNotificationChannel = 'email' | 'sms' | 'both'

export type VendorManagementRow = {
  id: string
  name: string
  category: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  country: string | null
  notification_channel: VendorNotificationChannel
  active: boolean
  /** Prefer for work-order coordination (`vendors.preferred_emergency`). */
  preferredEmergency: boolean
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

function IconPencilHeader({ className = 'size-5 text-extended-1' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [country, setCountry] = useState('United States')
  const [notificationChannel, setNotificationChannel] =
    useState<VendorNotificationChannel>('email')
  const [category, setCategory] = useState('')
  const [active, setActive] = useState(true)
  const [preferredEmergency, setPreferredEmergency] = useState(false)
  const [contactName, setContactName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initial) {
      const channel = initial.notification_channel
      setName(initial.name)
      setCategory(normalizeVendorCategoryForForm(initial.category))
      setEmail(initial.email ?? '')
      setPhone(initial.phone ?? '')
      setCity(initial.city ?? '')
      setState(initial.state ?? '')
      setCountry(initial.country ?? '')
      setNotificationChannel(
        channel === 'sms' || channel === 'both' || channel === 'email' ? channel : 'email',
      )
      setActive(initial.active)
      setPreferredEmergency(initial.preferredEmergency)
      setContactName(initial.contactName ?? '')
    } else {
      setName('')
      setCategory('')
      setEmail('')
      setPhone('')
      setCity('')
      setState('')
      setCountry('United States')
      setNotificationChannel('email')
      setActive(true)
      setPreferredEmergency(false)
      setContactName('')
    }
    setSaveError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate only when the rail opens
  }, [open])

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
    if (!contactName.trim()) {
      setSaveError('Contact name is required.')
      return
    }
    const categoryResolved = resolveVendorCategoryPayload(category)
    if (!categoryResolved.ok) {
      setSaveError(categoryResolved.message)
      return
    }
    const categoryPayload = categoryResolved.payload
    const contactNamePayload = contactName.trim()
    const emailPayload = email.trim() || null
    const phoneResult = phoneForDbOrError(phone)
    if (phoneResult.error) {
      setSaveError(phoneResult.error)
      return
    }
    const phonePayload = phoneResult.phone
    const cityPayload = emptyToNull(city)
    const statePayload = emptyToNull(state)
    const countryPayload = emptyToNull(country)

    if (emailSelected && !emailPayload) {
      setSaveError('Email is required when Email delivery is selected.')
      return
    }
    if (smsSelected && !phonePayload) {
      setSaveError('A valid phone number is required when SMS delivery is selected.')
      return
    }
    if (!emailPayload && !phonePayload) {
      setSaveError('Enter an email address or phone number so we can reach this vendor.')
      return
    }

    if (!supabase) {
      setSaveError('Supabase is not configured.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (mode === 'add') {
        console.log('[vendor-form] submit (add)', {
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
          preferred_emergency: preferredEmergency,
        })
        const { data, error } = await supabase
          .from('vendors')
          .insert({
            name: n,
            contact_name: contactNamePayload,
            category: categoryPayload,
            email: emailPayload,
            phone: phonePayload,
            city: cityPayload,
            state: statePayload,
            country: countryPayload,
            notification_channel: notificationChannel,
            active,
            preferred_emergency: preferredEmergency,
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
        onSaved(undefined)
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
          preferred_emergency: preferredEmergency,
        })
        const { error } = await supabase
          .from('vendors')
          .update({
            name: n,
            contact_name: contactNamePayload,
            category: categoryPayload,
            email: emailPayload,
            phone: phonePayload,
            city: cityPayload,
            state: statePayload,
            country: countryPayload,
            notification_channel: notificationChannel,
            active,
            preferred_emergency: preferredEmergency,
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
      console.warn('[vendor-form] save failed', e)
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
            {mode === 'edit' ? (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
                <IconPencilHeader />
              </div>
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#E0F2EF] text-[#101828]">
                <svg viewBox="0 0 15 15" fill="currentColor" className="size-5" aria-hidden>
                  <path d="M4.76665 7.13354L7.86614 10.233L3.463 14.6362C2.97888 15.1203 2.19375 15.1203 1.70888 14.6362L0.363451 13.2907C-0.120662 12.8059 -0.120662 12.0215 0.363451 11.5366L4.76665 7.13354Z" />
                  <path d="M13.0933 2.98746L9.22397 6.8568L8.14294 5.77578L12.0123 1.90644C12.1712 1.7475 12.2796 1.54463 12.3243 1.32417L12.3565 1.16377C12.3968 0.959439 12.5199 0.780718 12.6949 0.669402L13.5591 0.119365C13.8609 -0.072518 14.2564 -0.0293134 14.5098 0.224098L14.7757 0.489967C15.0291 0.743386 15.0723 1.13887 14.8804 1.44063L14.3304 2.30487C14.219 2.47991 14.0403 2.60295 13.836 2.64324L13.6756 2.67547C13.4551 2.72014 13.2523 2.82852 13.0933 2.98746Z" />
                  <path d="M3.89062 5.72735L9.27231 11.109C9.42611 10.7025 9.66708 10.321 9.99374 9.99358C10.3211 9.66693 10.7027 9.42598 11.1092 9.27216L5.7275 3.89047C5.5737 4.29696 5.33273 4.67853 5.00607 5.00592C4.67869 5.33258 4.29712 5.57353 3.89062 5.72735Z" />
                  <path d="M2.69108 0.233537C2.64201 0.39247 2.68083 0.614378 2.85587 0.788693L3.35465 1.28747C3.75967 1.6925 3.75967 2.34873 3.35465 2.75374L2.75408 3.35431C2.34905 3.75933 1.69282 3.75933 1.28781 3.35431L0.789033 2.85553C0.61472 2.68049 0.392799 2.64167 0.233877 2.69074C0.15551 2.71491 0.0939889 2.75959 0.0551717 2.81818C0.0163545 2.87604 -0.00927988 2.95953 0.00317169 3.07525C0.0698207 3.68388 0.336407 4.27419 0.802953 4.74074C1.53096 5.46875 2.56365 5.70972 3.49314 5.46143C3.95016 5.33985 4.38228 5.09962 4.74115 4.74074C5.10003 4.38185 5.33952 3.94973 5.46184 3.49273C5.71012 2.56332 5.46917 1.53059 4.74115 0.802545C4.2746 0.336 3.68429 0.0694001 3.07566 0.00349541C2.95994 -0.00968778 2.87645 0.0159463 2.81859 0.0547641C2.75999 0.0935813 2.71525 0.155172 2.69108 0.233537Z" />
                  <path d="M14.1972 10.2587C13.4691 9.53073 12.4365 9.28976 11.507 9.53805C11.0499 9.66036 10.6178 9.89985 10.259 10.2587C9.90007 10.6176 9.66058 11.0497 9.53826 11.5067C9.28998 12.4362 9.53094 13.4689 10.259 14.1977C10.7255 14.6635 11.3158 14.9301 11.9244 14.9967C12.0402 15.0092 12.1237 14.9836 12.1815 14.9447C12.2401 14.9059 12.2848 14.8444 12.309 14.766C12.358 14.6071 12.3192 14.3852 12.1442 14.2109L11.6454 13.7121C11.2404 13.3071 11.2404 12.6508 11.6454 12.2458L12.246 11.6453C12.651 11.2402 13.3072 11.2402 13.7122 11.6453L14.211 12.144C14.3853 12.3191 14.6072 12.3579 14.7662 12.3088C14.8445 12.2847 14.906 12.24 14.9449 12.1814C14.9837 12.1235 15.0093 12.04 14.9969 11.9243C14.9302 11.3157 14.6637 10.7253 14.1972 10.2587Z" />
                </svg>
              </div>
            )}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="vendor-form-city" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  City
                </label>
                <input
                  id="vendor-form-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={vendorFormInputClass}
                  autoComplete="address-level2"
                  placeholder="e.g., Atlanta"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="vendor-form-state" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  State
                </label>
                <input
                  id="vendor-form-state"
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={vendorFormInputClass}
                  autoComplete="address-level1"
                  placeholder="e.g., GA"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="vendor-form-country" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Country
                </label>
                <input
                  id="vendor-form-country"
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={vendorFormInputClass}
                  autoComplete="country-name"
                  placeholder="e.g., United States"
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
            <div className="space-y-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Preferred vendor
              </p>
              <div className="flex w-full rounded-[10px] border border-[#e5e7eb] bg-[#f3f3f5] p-1">
                <button
                  type="button"
                  onClick={() => setPreferredEmergency(true)}
                  className={[
                    'sa-pill h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
                    preferredEmergency
                      ? 'bg-white text-[#0a0a0a] shadow-sm'
                      : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={preferredEmergency}
                >
                  Preferred
                </button>
                <button
                  type="button"
                  onClick={() => setPreferredEmergency(false)}
                  className={[
                    'sa-pill h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
                    !preferredEmergency
                      ? 'bg-white text-[#0a0a0a] shadow-sm'
                      : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={!preferredEmergency}
                >
                  Standard
                </button>
              </div>
              <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                Preferred vendors are offered first when coordinating work orders,
                ahead of other specialists or generalists in the same trade.
              </p>
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
