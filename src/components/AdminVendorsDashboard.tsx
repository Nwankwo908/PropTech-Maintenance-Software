import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sendVendorInvite, type VendorInviteChannel } from '@/api/vendorVerification'
import { VendorFormModal } from '@/components/VendorFormModal'
import { TableCheckbox } from '@/components/TableCheckbox'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { vendorDetailPath } from '@/lib/vendorRoutes'
import { dedupeVendorsByName, duplicateVendorIdsToRemove } from '@/lib/vendorDedup'
import { supabase } from '@/lib/supabase'
import {
  dbCategoryToVendorTrade,
  formatVendorTradeLabel,
  isGeneralistTrade,
  VENDOR_TRADE_OPTIONS,
} from '@/lib/vendorTrades'
import { resolveVendorCapacityChip, countUnactivatedVendors, vendorCapacityChipVisualClasses } from '@/lib/vendorStatusChip'

type VendorRow = {
  id: string
  name: string
  trade: string
  category: string | null
  email: string | null
  phone: string | null
  rating: number | null
  reviewCount: number
  completedJobs: number
  avgResponseMinutes: number | null
  active: boolean
  rosterStatus: string | null
  createdAt: string | null
}

type RatingSort = 'desc' | 'asc'

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatTrade(category: string | null): string {
  return formatVendorTradeLabel(category)
}

function vendorMatchesTrade(vendor: VendorRow, tradeFilter: string): boolean {
  if (!tradeFilter) return true
  if (tradeFilter === 'general' || tradeFilter === '__generalist__') {
    return isGeneralistTrade(vendor.category)
  }
  return dbCategoryToVendorTrade(vendor.category) === tradeFilter
}

function formatRating(score: number | null, reviewCount: number): string {
  if (score == null) return '—'
  return `${score.toFixed(1)} (${reviewCount.toLocaleString()})`
}

function VerificationPill({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-[12px] font-medium text-[#6a7282]">
        Not started
      </span>
    )
  }
  const config: Record<string, { label: string; className: string }> = {
    verified: { label: 'Verified', className: 'bg-[#dbfce7] text-[#008236]' },
    needs_review: { label: 'Needs review', className: 'bg-[#fef9c3] text-[#92400e]' },
    submitted: { label: 'In review', className: 'bg-[#fef9c3] text-[#92400e]' },
    in_progress: { label: 'In progress', className: 'bg-[#e0e7ff] text-[#3730a3]' },
    invited: { label: 'Invited', className: 'bg-[#f3f4f6] text-[#6a7282]' },
  }
  const entry = config[status] ?? { label: status, className: 'bg-[#f3f4f6] text-[#6a7282]' }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${entry.className}`}
    >
      {entry.label}
    </span>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M12 17.3l-6.18 3.7 1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.46 4.73L18.18 21z" />
    </svg>
  )
}

function FilterChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sa-surface peer h-9 min-w-[140px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-none outline-none hover:border-black/10 hover:bg-[#e8eaee] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
        <FilterChevronDown />
      </span>
    </div>
  )
}

function FilterToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-[#e5e7eb] bg-[#f3f3f5] p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={[
              'sa-pill inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[13px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
              isActive
                ? 'bg-white text-[#0a0a0a] shadow-sm'
                : 'text-[#6a7282] hover:text-[#364153]',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ActivationReminderAlertIcon() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 text-[#101828]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
    </svg>
  )
}

export function AdminVendorsDashboard() {
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scoresError, setScoresError] = useState<string | null>(null)
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  const [verificationByVendor, setVerificationByVendor] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [availabilityByVendor, setAvailabilityByVendor] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')
  const [ratingSort, setRatingSort] = useState<RatingSort>('desc')
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(() => new Set())
  const [deleteVendorsSaving, setDeleteVendorsSaving] = useState(false)
  const [deleteVendorsError, setDeleteVendorsError] = useState<string | null>(null)
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [onboardingNotice, setOnboardingNotice] = useState<string | null>(null)
  const loadVendors = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured — connect a project to see vendors.')
      return
    }

    setLoading(true)
    setError(null)
    setScoresError(null)

    const landlordId = getActiveLandlordId()
    const [vendorsResult, scoresResult] = await Promise.allSettled([
      supabase
        .from('vendors')
        .select('id, name, category, active, roster_status, email, phone, created_at')
        .eq('landlord_id', landlordId)
        .order('created_at', { ascending: true }),
      supabase.rpc('get_vendor_scores_for_landlord', {
        p_landlord_id: landlordId,
      }),
    ])

    if (vendorsResult.status !== 'fulfilled' || vendorsResult.value.error) {
      const message =
        vendorsResult.status === 'fulfilled'
          ? vendorsResult.value.error?.message
          : String(vendorsResult.reason)
      setError(message ?? 'Failed to load vendors.')
      setLoading(false)
      return
    }

    const scoreByVendor = new Map<
      string,
      {
        rating: number | null
        reviewCount: number
        completedJobs: number
        avgResponseMinutes: number | null
      }
    >()

    let scoresWarning: string | null = null
    if (scoresResult.status === 'fulfilled') {
      if (scoresResult.value.error) {
        scoresWarning = scoresResult.value.error.message
      } else {
        for (const raw of (scoresResult.value.data ?? []) as Record<string, unknown>[]) {
          const vendorId = asString(raw.vendor_id)
          if (!vendorId) continue
          scoreByVendor.set(vendorId, {
            rating: asFiniteNumber(raw.vendor_score),
            reviewCount: asFiniteNumber(raw.review_count) ?? 0,
            completedJobs: asFiniteNumber(raw.completed_jobs) ?? 0,
            avgResponseMinutes: asFiniteNumber(raw.avg_response_time),
          })
        }
      }
    } else {
      scoresWarning = String(scoresResult.reason)
    }

    if (scoresWarning) {
      console.warn('[AdminVendorsDashboard] get_vendor_scores_for_landlord', scoresWarning)
      setScoresError(scoresWarning)
    }

    const rows: VendorRow[] = (
      (vendorsResult.value.data ?? []) as Record<string, unknown>[]
    ).map((raw) => {
      const id = asString(raw.id)
      const category = asString(raw.category) || null
      const metrics = scoreByVendor.get(id)
      return {
        id,
        name: asString(raw.name) || 'Unnamed vendor',
        trade: formatTrade(category),
        category,
        email: asString(raw.email) || null,
        phone: asString(raw.phone) || null,
        rating: metrics?.rating ?? null,
        reviewCount: metrics?.reviewCount ?? 0,
        completedJobs: metrics?.completedJobs ?? 0,
        avgResponseMinutes: metrics?.avgResponseMinutes ?? null,
        active: raw.active !== false,
        rosterStatus: asString(raw.roster_status) || null,
        createdAt: asString(raw.created_at) || null,
      }
    })

    const duplicateIds = duplicateVendorIdsToRemove(rows)
    if (duplicateIds.length > 0) {
      const { error: unassignError } = await supabase
        .from('maintenance_requests')
        .update({
          assigned_vendor_id: null,
          vendor_work_status: 'unassigned',
        })
        .eq('landlord_id', landlordId)
        .in('assigned_vendor_id', duplicateIds)

      if (!unassignError) {
        const { error: deleteError } = await supabase
          .from('vendors')
          .delete()
          .eq('landlord_id', landlordId)
          .in('id', duplicateIds)

        if (deleteError) {
          console.warn('[AdminVendorsDashboard] duplicate vendor cleanup', deleteError.message)
        }
      } else {
        console.warn('[AdminVendorsDashboard] duplicate vendor unassign', unassignError.message)
      }
    }

    setVendors(dedupeVendorsByName(rows))
    setLoading(false)
  }, [])

  const loadVerifications = useCallback(async () => {
    if (!supabase) return
    const landlordId = getActiveLandlordId()
    const { data, error: vErr } = await supabase
      .from('vendor_verifications')
      .select('vendor_id, status, availability, updated_at')
      .eq('landlord_id', landlordId)
      .not('vendor_id', 'is', null)
      .order('updated_at', { ascending: true })
    if (vErr || !data) {
      if (vErr) console.warn('[AdminVendorsDashboard] vendor_verifications', vErr.message)
      return
    }
    const map = new Map<string, string>()
    const availabilityMap = new Map<string, string>()
    for (const raw of data as Record<string, unknown>[]) {
      const vendorId = asString(raw.vendor_id)
      const status = asString(raw.status)
      const availability = asString(raw.availability)
      if (vendorId && status) map.set(vendorId, status)
      if (vendorId && availability) availabilityMap.set(vendorId, availability)
    }
    setVerificationByVendor(map)
    setAvailabilityByVendor(availabilityMap)
  }, [])

  useEffect(() => {
    void loadVendors()
    void loadVerifications()
  }, [loadVendors, loadVerifications])

  const tradeOptions = useMemo(() => {
    return VENDOR_TRADE_OPTIONS.map((trade) => ({
      value: trade.value,
      label: trade.label,
    }))
  }, [])

  const filteredVendors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = vendors.filter((vendor) => {
      const matchesSearch =
        !q ||
        vendor.name.toLowerCase().includes(q) ||
        vendor.trade.toLowerCase().includes(q) ||
        (vendor.email?.toLowerCase().includes(q) ?? false) ||
        (vendor.phone?.toLowerCase().includes(q) ?? false)
      if (!matchesSearch) return false
      if (!vendorMatchesTrade(vendor, tradeFilter)) return false
      return true
    })

    return filtered.sort((a, b) => {
      const ratingA = a.rating ?? -1
      const ratingB = b.rating ?? -1
      const ratingDelta = ratingSort === 'desc' ? ratingB - ratingA : ratingA - ratingB
      if (ratingDelta !== 0) return ratingDelta
      const jobsDelta = b.completedJobs - a.completedJobs
      if (jobsDelta !== 0) return jobsDelta
      return a.name.localeCompare(b.name)
    })
  }, [vendors, searchQuery, tradeFilter, ratingSort])

  const unactivatedVendorCount = useMemo(
    () =>
      countUnactivatedVendors(
        vendors.map((vendor) => ({
          verificationStatus: verificationByVendor.get(vendor.id),
          vendorActive: vendor.active,
          availability: availabilityByVendor.get(vendor.id),
          rosterStatus: vendor.rosterStatus,
        })),
      ),
    [vendors, verificationByVendor, availabilityByVendor],
  )

  const selectedVendorCount = selectedVendorIds.size
  const allFilteredVendorsSelected =
    filteredVendors.length > 0 && filteredVendors.every((vendor) => selectedVendorIds.has(vendor.id))
  const someFilteredVendorsSelected =
    filteredVendors.some((vendor) => selectedVendorIds.has(vendor.id)) && !allFilteredVendorsSelected

  function toggleVendorSelected(id: string) {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFilteredVendorsSelected() {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev)
      if (allFilteredVendorsSelected) {
        for (const vendor of filteredVendors) next.delete(vendor.id)
      } else {
        for (const vendor of filteredVendors) next.add(vendor.id)
      }
      return next
    })
  }

  async function deleteSelectedVendors() {
    if (selectedVendorIds.size === 0 || !supabase) return

    setDeleteVendorsError(null)
    setDeleteVendorsSaving(true)

    const landlordId = getActiveLandlordId()
    const idsToDelete = Array.from(selectedVendorIds)

    const { error: unassignError } = await supabase
      .from('maintenance_requests')
      .update({
        assigned_vendor_id: null,
        vendor_work_status: 'unassigned',
      })
      .eq('landlord_id', landlordId)
      .in('assigned_vendor_id', idsToDelete)

    if (unassignError) {
      setDeleteVendorsError(unassignError.message)
      setDeleteVendorsSaving(false)
      return
    }

    const { error } = await supabase
      .from('vendors')
      .delete()
      .eq('landlord_id', landlordId)
      .in('id', idsToDelete)

    if (error) {
      setDeleteVendorsError(error.message)
      setDeleteVendorsSaving(false)
      return
    }

    setVendors((prev) => prev.filter((vendor) => !selectedVendorIds.has(vendor.id)))
    setSelectedVendorIds(new Set())
    setDeleteVendorsSaving(false)
  }

  async function startOnboardingForSelected() {
    if (selectedVendorIds.size === 0) return

    setOnboardingNotice(null)
    setOnboardingSaving(true)

    const landlordId = getActiveLandlordId()
    const selected = vendors.filter((vendor) => selectedVendorIds.has(vendor.id))
    const toInvite: VendorRow[] = []
    let missingContact = 0
    let alreadyComplete = 0

    for (const vendor of selected) {
      const phone = vendor.phone?.trim() ?? ''
      const email = vendor.email?.trim() ?? ''
      if (!phone && !email) {
        missingContact += 1
        continue
      }

      const chip = resolveVendorCapacityChip({
        verificationStatus: verificationByVendor.get(vendor.id),
        vendorActive: vendor.active,
        availability: availabilityByVendor.get(vendor.id),
        rosterStatus: vendor.rosterStatus,
      })

      if (
        chip.status === 'active' ||
        chip.status === 'paused' ||
        chip.status === 'pending' ||
        chip.status === 'docs_submitted' ||
        chip.status === 'suspended' ||
        chip.status === 'banned'
      ) {
        alreadyComplete += 1
        continue
      }

      if (chip.status === 'not_started') {
        toInvite.push(vendor)
      }
    }

    if (toInvite.length === 0) {
      setOnboardingSaving(false)
      if (missingContact > 0 && alreadyComplete === 0) {
        setOnboardingNotice(
          'Selected vendors need a phone number or email before onboarding can start.',
        )
      } else if (alreadyComplete > 0 && missingContact === 0) {
        setOnboardingNotice(
          'Selected vendors are already activated, waiting for verification, or under review.',
        )
      } else {
        setOnboardingNotice(
          'No selected vendors are ready for onboarding. Add contact info or choose vendors who have not been invited yet.',
        )
      }
      return
    }

    let sent = 0
    let failed = 0
    let lastError: string | undefined

    for (const vendor of toInvite) {
      const phone = vendor.phone?.trim() ?? ''
      const email = vendor.email?.trim() ?? ''
      const channel: VendorInviteChannel =
        phone && email ? 'both' : phone ? 'sms' : 'email'

      try {
        const result = await sendVendorInvite({
          landlordId,
          vendorId: vendor.id,
          businessName: vendor.name,
          email: email || undefined,
          phone: phone || undefined,
          channel,
          tradeCategories: vendor.category ? [vendor.category] : undefined,
        })
        const anySent =
          result.delivery.sms === 'sent' || result.delivery.email === 'sent'
        if (anySent) {
          sent += 1
        } else {
          failed += 1
          lastError = 'Verification invite could not be delivered.'
        }
      } catch (err) {
        failed += 1
        lastError = getErrorMessage(err, 'Something went wrong. Please try again.')
      }
    }

    await Promise.all([loadVendors(), loadVerifications()])
    setOnboardingSaving(false)

    if (sent > 0 && failed === 0) {
      const parts = [
        sent === 1
          ? 'Verification invite sent to 1 vendor.'
          : `Verification invites sent to ${sent} vendors.`,
      ]
      if (missingContact > 0) {
        parts.push(`${missingContact} skipped (no contact info on file).`)
      }
      setOnboardingNotice(parts.join(' '))
      return
    }

    if (sent > 0) {
      setOnboardingNotice(
        `Verification invites sent to ${sent} vendor${sent === 1 ? '' : 's'}, but ${failed} could not be delivered.${
          missingContact > 0 ? ` ${missingContact} skipped (no contact info on file).` : ''
        }`,
      )
      return
    }

    setOnboardingNotice(
      lastError ??
        'Verification invites could not be sent. Check contact info and try again.',
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="flex items-start justify-between gap-3 py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Vendors
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Keep track of your vendors, assign work orders, and manage repairs in one place.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAddVendorOpen(true)}
            className="sa-press inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-transparent px-4 text-[14px] font-medium leading-5 text-[#186179] outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="size-4 shrink-0"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Add vendor
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      {scoresError ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          Vendor scores could not be loaded ({scoresError}). Ratings and response times may be
          incomplete.
        </div>
      ) : null}

      {!loading && unactivatedVendorCount > 0 ? (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-[#E8A5AA] bg-[#F6B9BE] px-4 py-3 text-[13px] leading-5 text-[#364153]"
          role="status"
        >
          <ActivationReminderAlertIcon />
          <p className="text-[#101828]">
            {unactivatedVendorCount === 1
              ? '1 vendor has not been activated yet.'
              : `${unactivatedVendorCount} vendors have not been activated yet.`}{' '}
            Select the checkbox to start onboarding when you&apos;re ready.
          </p>
        </div>
      ) : null}

      <div className="sa-surface mb-4 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-[240px]">
            <span className="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
              <img
                src={magnifyingGlassIcon}
                alt=""
                className="size-4 object-contain opacity-60"
                width={16}
                height={16}
                decoding="async"
                aria-hidden
              />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vendors by name, trade, email, or phone…"
              className="sa-surface h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none hover:border-black/10 hover:bg-[#dfe0e6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
              aria-label="Search vendors"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              label="All trades"
              options={tradeOptions}
              value={tradeFilter}
              onChange={setTradeFilter}
            />
            <FilterToggleGroup
              label="Sort by rating"
              value={ratingSort}
              options={[
                { value: 'desc', label: 'Highest rated' },
                { value: 'asc', label: 'Lowest rated' },
              ]}
              onChange={setRatingSort}
            />
          </div>
        </div>
      </div>

      {deleteVendorsError ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          Could not delete selected vendors: {deleteVendorsError}
        </div>
      ) : null}
      {onboardingNotice ? (
        <div className="mb-4 rounded-[10px] border border-[#E8A5AA] bg-[#F6B9BE] px-4 py-3 text-[13px] leading-5 text-[#101828]">
          {onboardingNotice}
        </div>
      ) : null}

      {selectedVendorCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
            <span className="font-medium">{selectedVendorCount}</span>
            {selectedVendorCount === 1 ? ' vendor selected' : ' vendors selected'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedVendorIds(new Set())}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={onboardingSaving || deleteVendorsSaving}
              onClick={() => void startOnboardingForSelected()}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg bg-[#187960] px-3 text-[14px] font-medium text-white outline-none hover:bg-[#146b52] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {onboardingSaving ? 'Starting…' : 'Start onboarding'}
            </button>
            <button
              type="button"
              disabled={deleteVendorsSaving || onboardingSaving}
              onClick={() => void deleteSelectedVendors()}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteVendorsSaving ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
        </div>
      ) : null}

      <section className="sa-surface overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="w-12 px-4 py-3">
                  <TableCheckbox
                    aria-label="Select all visible vendors"
                    disabled={loading || filteredVendors.length === 0}
                    checked={allFilteredVendorsSelected}
                    indeterminate={someFilteredVendorsSelected}
                    onChange={toggleAllFilteredVendorsSelected}
                  />
                </th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Vendor</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Trade</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Rating</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Completed jobs</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Verification</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Activation</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    Loading vendors…
                  </td>
                </tr>
              ) : filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    {vendors.length === 0
                      ? 'No vendors yet. Add vendors so Ulo can route work to them.'
                      : 'No vendors match your search or filters.'}
                  </td>
                </tr>
              ) : (
                filteredVendors.map((vendor, index) => (
                  <tr
                    key={vendor.id}
                    style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                    className="sa-enter border-b border-[#f3f4f6] last:border-b-0"
                  >
                    <td className="w-12 px-4 py-4">
                      <TableCheckbox
                        aria-label={`Select ${vendor.name}`}
                        checked={selectedVendorIds.has(vendor.id)}
                        onChange={() => toggleVendorSelected(vendor.id)}
                      />
                    </td>
                    <td className="px-6 py-4 text-[14px] font-medium text-[#0a0a0a]">
                      <Link
                        to={vendorDetailPath(vendor.id)}
                        className="sa-link rounded-[4px] text-[#0a0a0a] hover:text-[#186179] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        {vendor.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">{vendor.trade}</td>
                    <td className="px-6 py-4">
                      {vendor.rating != null ? (
                        <span className="inline-flex items-center gap-1.5 text-[14px] text-[#0a0a0a]">
                          <span className="text-[#f59e0b]">
                            <StarIcon />
                          </span>
                          <span className="tabular-nums">
                            {formatRating(vendor.rating, vendor.reviewCount)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[14px] text-[#6a7282]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#0a0a0a]">
                      {vendor.completedJobs}
                    </td>
                    <td className="px-6 py-4">
                      <VerificationPill status={verificationByVendor.get(vendor.id)} />
                    </td>
                    <td className="px-6 py-4 align-middle">
                      {(() => {
                        const chip = resolveVendorCapacityChip({
                          verificationStatus: verificationByVendor.get(vendor.id),
                          vendorActive: vendor.active,
                          availability: availabilityByVendor.get(vendor.id),
                          rosterStatus: vendor.rosterStatus,
                        })
                        const styles = vendorCapacityChipVisualClasses(chip.status)
                        return (
                          <span
                            title={chip.detail}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${styles.pill}`}
                          >
                            <span
                              className={`inline-block size-2 shrink-0 rounded-full ${styles.dot}`}
                              aria-hidden
                            />
                            {chip.label}
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <VendorFormModal
        open={addVendorOpen}
        mode="add"
        initial={null}
        onClose={() => setAddVendorOpen(false)}
        onSaved={() => {
          setAddVendorOpen(false)
          void loadVendors()
        }}
      />
    </main>
  )
}

export default AdminVendorsDashboard
