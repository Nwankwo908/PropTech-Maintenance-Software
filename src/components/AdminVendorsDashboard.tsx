import { useCallback, useEffect, useMemo, useState } from 'react'
import { VendorFormModal } from '@/components/AdminUserManagementDashboard'
import { TableCheckbox } from '@/components/TableCheckbox'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { dedupeVendorsByName, duplicateVendorIdsToRemove } from '@/lib/vendorDedup'
import { supabase } from '@/lib/supabase'

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
  createdAt: string | null
}

type StatusFilter = 'all' | 'active' | 'backup'
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
  if (!category) return 'General'
  return category
    .split(/[_-]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function formatResponse(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  return hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`
}

function formatRating(score: number | null, reviewCount: number): string {
  if (score == null) return '—'
  const reviews =
    reviewCount === 1 ? '1 review' : `${reviewCount.toLocaleString()} reviews`
  return `${score.toFixed(1)} (${reviews})`
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

function vendorMatchesTrade(vendor: VendorRow, tradeFilter: string): boolean {
  if (!tradeFilter) return true
  if (tradeFilter === '__generalist__') {
    return vendor.category == null || vendor.category.trim() === ''
  }
  return (vendor.category ?? '').toLowerCase() === tradeFilter.toLowerCase()
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
        className="peer h-9 min-w-[140px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-none outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-black/10 hover:bg-[#e8eaee] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
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
              'inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[13px] font-medium tracking-[-0.1504px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
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

export function AdminVendorsDashboard() {
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scoresError, setScoresError] = useState<string | null>(null)
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [ratingSort, setRatingSort] = useState<RatingSort>('desc')
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(() => new Set())
  const [deleteVendorsSaving, setDeleteVendorsSaving] = useState(false)
  const [deleteVendorsError, setDeleteVendorsError] = useState<string | null>(null)

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
        .select('id, name, category, active, email, phone, created_at')
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

  useEffect(() => {
    void loadVendors()
  }, [loadVendors])

  const tradeOptions = useMemo(() => {
    const categories = new Set<string>()
    let hasGeneralist = false
    for (const vendor of vendors) {
      if (vendor.category?.trim()) {
        categories.add(vendor.category.trim().toLowerCase())
      } else {
        hasGeneralist = true
      }
    }
    const options = [...categories]
      .sort((a, b) => formatTrade(a).localeCompare(formatTrade(b)))
      .map((value) => ({ value, label: formatTrade(value) }))
    if (hasGeneralist) {
      options.push({ value: '__generalist__', label: 'Generalist' })
    }
    return options
  }, [vendors])

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
      if (statusFilter === 'active') return vendor.active
      if (statusFilter === 'backup') return !vendor.active
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
  }, [vendors, searchQuery, tradeFilter, statusFilter, ratingSort])

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
        <button
          type="button"
          onClick={() => setAddVendorOpen(true)}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-black/10 bg-white px-4 text-[14px] font-medium leading-5 text-tertiary outline-none transition-colors duration-150 hover:bg-[#e2f5f1] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
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

      <div className="mb-4 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
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
              className="h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-black/10 hover:bg-[#dfe0e6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
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
              label="Vendor status"
              value={statusFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'backup', label: 'Backup' },
              ]}
              onChange={setStatusFilter}
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
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={deleteVendorsSaving}
              onClick={() => void deleteSelectedVendors()}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteVendorsSaving ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
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
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Avg response</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Status</th>
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
                filteredVendors.map((vendor) => (
                  <tr key={vendor.id} className="border-b border-[#f3f4f6] last:border-b-0">
                    <td className="w-12 px-4 py-4">
                      <TableCheckbox
                        aria-label={`Select ${vendor.name}`}
                        checked={selectedVendorIds.has(vendor.id)}
                        onChange={() => toggleVendorSelected(vendor.id)}
                      />
                    </td>
                    <td className="px-6 py-4 text-[14px] font-medium text-[#0a0a0a]">
                      {vendor.name}
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
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#6a7282]">
                      {formatResponse(vendor.avgResponseMinutes)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={[
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium',
                          vendor.active
                            ? 'bg-[#dbfce7] text-[#008236]'
                            : 'bg-[#f3f4f6] text-[#6a7282]',
                        ].join(' ')}
                      >
                        {vendor.active ? 'Active' : 'Backup'}
                      </span>
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
