import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import { TableCheckbox } from '@/components/TableCheckbox'
import { loadUnitsFromDb } from '@/api/unitVacancy'
import { registerUnitSms, syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import {
  AddResidentModal,
  type AddResidentSubmitPayload,
} from '@/components/AddResidentModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { customUnitPickKey, unitOptionKeyToCell } from '@/lib/residentUnitKeys'
import { supabase } from '@/lib/supabase'

type Sentiment = 'positive' | 'at_risk' | 'neutral'
type SentimentFilter = 'all' | Sentiment
type BalanceSort = 'desc' | 'asc'

type ResidentRow = {
  id: string
  name: string
  unitLabel: string
  rentLabel: string
  moveInLabel: string
  contactPhone: string | null
  contactEmail: string | null
  leaseEndLabel: string
  balanceDue: number
  sentiment: Sentiment
  status: string
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function formatUnit(building: string | null, unit: string | null): string {
  const b = building?.trim().replace(/\s+Apartments$/i, '')
  const u = unit?.trim()
  if (b && u) return `${b} - ${u}`
  return u || b || '—'
}

function formatLeaseEnd(value: string | null): string {
  if (!value?.trim()) return '—'
  const date = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatMoveIn(value: string | null): string {
  if (!value?.trim()) return '—'
  const date = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function estimateMonthlyRent(unit: string | null): number {
  const unitNumber = Number.parseInt((unit ?? '').replace(/\D/g, ''), 10)
  if (!Number.isFinite(unitNumber)) return 1800
  if (unitNumber >= 500) return 2400
  if (unitNumber >= 400) return 2200
  if (unitNumber >= 300) return 2000
  if (unitNumber >= 200) return 1850
  return 1650
}

function formatBalance(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Infer sentiment from lease, balance, and account signals (proxy until AI sentiment pipeline ships). */
function inferSentiment(params: {
  status: string
  balanceDue: number
  leaseEndDate: string | null
  issues: string[]
}): Sentiment {
  const status = params.status.toLowerCase()
  if (params.balanceDue > 0 || status === 'suspended') return 'at_risk'

  const issuesText = params.issues.join(' ').toLowerCase()
  if (issuesText.includes('late') || issuesText.includes('overdue') || issuesText.includes('complaint')) {
    return 'at_risk'
  }

  if (status === 'active' && params.balanceDue <= 0) {
    if (params.leaseEndDate) {
      const end = new Date(`${params.leaseEndDate.trim()}T12:00:00`)
      const days = (end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      if (Number.isFinite(days) && days >= 0 && days <= 21) return 'neutral'
    }
    return 'positive'
  }

  return 'neutral'
}

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const config = {
    positive: {
      label: 'Positive',
      className: 'bg-[#dbfce7] text-[#008236]',
    },
    at_risk: {
      label: 'At risk',
      className: 'bg-[#ffedd5] text-[#c2410c]',
    },
    neutral: {
      label: 'Neutral',
      className: 'bg-[#f3f4f6] text-[#6a7282]',
    },
  }[sentiment]

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium',
        config.className,
      ].join(' ')}
    >
      {config.label}
    </span>
  )
}

const SENTIMENT_FILTER_OPTIONS: { value: Sentiment; label: string }[] = [
  { value: 'positive', label: 'Positive' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'neutral', label: 'Neutral' },
]

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

export function AdminResidentsDashboard() {
  const [residents, setResidents] = useState<ResidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [balanceSort, setBalanceSort] = useState<BalanceSort>('desc')
  const [addResidentOpen, setAddResidentOpen] = useState(false)
  const [addResidentError, setAddResidentError] = useState<string | null>(null)
  const [unitOptions, setUnitOptions] = useState<{ value: string; label: string }[]>([])
  const [selectedResidentIds, setSelectedResidentIds] = useState<Set<string>>(() => new Set())
  const [deleteResidentsSaving, setDeleteResidentsSaving] = useState(false)
  const [deleteResidentsError, setDeleteResidentsError] = useState<string | null>(null)

  const loadResidents = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured — connect a project to see residents.')
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('users')
      .select(
        'id, full_name, unit, building, status, balance_due, lease_end_date, move_in_date, phone, email, issues',
      )
      .eq('landlord_id', getActiveLandlordId())
      .neq('status', 'past_resident')

    if (fetchError) {
      setError(fetchError.message)
      setResidents([])
      setLoading(false)
      return
    }

    const rows: ResidentRow[] = ((data ?? []) as Record<string, unknown>[])
      .map((raw) => {
        const balanceDue = asFiniteNumber(raw.balance_due)
        const status = asString(raw.status) || 'active'
        const leaseEndDate = asString(raw.lease_end_date) || null
        const unit = asString(raw.unit) || null
        const phone = asString(raw.phone) || null
        const email = asString(raw.email) || null
        return {
          id: asString(raw.id),
          name: asString(raw.full_name) || 'Unnamed resident',
          unitLabel: formatUnit(asString(raw.building) || null, unit),
          rentLabel: formatBalance(estimateMonthlyRent(unit)),
          moveInLabel: formatMoveIn(asString(raw.move_in_date) || null),
          contactPhone: phone,
          contactEmail: email,
          leaseEndLabel: formatLeaseEnd(leaseEndDate),
          balanceDue,
          sentiment: inferSentiment({
            status,
            balanceDue,
            leaseEndDate,
            issues: asStringArray(raw.issues),
          }),
          status,
        }
      })
      .filter((row) => row.id)

    setResidents(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadResidents()
  }, [loadResidents])

  useEffect(() => {
    void loadUnitsFromDb().then((rows) => {
      const landlordId = getActiveLandlordId()
      setUnitOptions(
        rows
          .filter((row) => row.landlord_id === landlordId && row.unit_label.trim())
          .map((row) => {
            const building = row.building?.trim() ?? ''
            const unit = row.unit_label.trim()
            return {
              value: customUnitPickKey(unit, building),
              label: building ? `${building} — ${unit}` : unit,
            }
          }),
      )
    })
  }, [])

  async function addResidentFromModal(payload: AddResidentSubmitPayload) {
    setAddResidentError(null)
    if (!supabase) {
      setAddResidentError('Supabase is not configured — connect a project to add residents.')
      return
    }

    const landlordId = getActiveLandlordId()
    const { data: existingRows, error: existingError } = await supabase
      .from('users')
      .select('resident_id')
      .eq('landlord_id', landlordId)

    if (existingError) {
      setAddResidentError(existingError.message)
      return
    }

    let nextResidentNumber = 1
    for (const row of (existingRows ?? []) as Record<string, unknown>[]) {
      const rawId = asString(row.resident_id)
      const parsed = Number.parseInt(rawId.replace(/^RES-/i, ''), 10)
      if (Number.isFinite(parsed)) {
        nextResidentNumber = Math.max(nextResidentNumber, parsed + 1)
      }
    }

    const residentId = `RES-${String(nextResidentNumber).padStart(3, '0')}`
    const unitCell = payload.unit ? unitOptionKeyToCell(payload.unit) : { kind: 'unassigned' as const }

    const { data: insertedRow, error: insertError } = await supabase
      .from('users')
      .insert({
        resident_id: residentId,
        full_name: payload.fullName,
        email: payload.email,
        phone: payload.phone || null,
        unit: unitCell.kind === 'assigned' ? unitCell.unit : null,
        building: unitCell.kind === 'assigned' ? unitCell.building : null,
        status: payload.status,
        balance_due: 0,
        issues: [],
        landlord_id: landlordId,
      })
      .select('id')
      .single()

    if (insertError) {
      setAddResidentError(insertError.message)
      return
    }

    const newResidentId = asString(insertedRow?.id)
    if (unitCell.kind === 'assigned' && newResidentId) {
      void registerUnitSms({
        unitLabel: unitCell.unit,
        building: unitCell.building,
        residentId: newResidentId,
        tenantPhone: payload.phone || null,
      })
    } else if (payload.phone?.trim() && newResidentId) {
      void syncSmsIdentity({
        phone: payload.phone,
        identityType: 'resident',
        residentId: newResidentId,
      })
    }

    await loadResidents()
  }

  const filteredResidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = residents.filter((resident) => {
      const matchesSearch =
        !q ||
        resident.name.toLowerCase().includes(q) ||
        resident.unitLabel.toLowerCase().includes(q) ||
        resident.leaseEndLabel.toLowerCase().includes(q) ||
        resident.moveInLabel.toLowerCase().includes(q) ||
        (resident.contactPhone ?? '').toLowerCase().includes(q) ||
        (resident.contactEmail ?? '').toLowerCase().includes(q)
      if (!matchesSearch) return false
      if (sentimentFilter !== 'all' && resident.sentiment !== sentimentFilter) return false
      return true
    })

    return filtered.sort((a, b) => {
      const balanceDelta =
        balanceSort === 'desc' ? b.balanceDue - a.balanceDue : a.balanceDue - b.balanceDue
      if (balanceDelta !== 0) return balanceDelta
      return a.name.localeCompare(b.name)
    })
  }, [residents, searchQuery, sentimentFilter, balanceSort])

  const selectedResidentCount = selectedResidentIds.size
  const allFilteredResidentsSelected =
    filteredResidents.length > 0 &&
    filteredResidents.every((resident) => selectedResidentIds.has(resident.id))
  const someFilteredResidentsSelected =
    filteredResidents.some((resident) => selectedResidentIds.has(resident.id)) &&
    !allFilteredResidentsSelected

  function toggleResidentSelected(id: string) {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFilteredResidentsSelected() {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (allFilteredResidentsSelected) {
        for (const resident of filteredResidents) next.delete(resident.id)
      } else {
        for (const resident of filteredResidents) next.add(resident.id)
      }
      return next
    })
  }

  async function deleteSelectedResidents() {
    if (selectedResidentIds.size === 0 || !supabase) return

    setDeleteResidentsError(null)
    setDeleteResidentsSaving(true)

    const landlordId = getActiveLandlordId()
    const idsToDelete = Array.from(selectedResidentIds)

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('landlord_id', landlordId)
      .in('id', idsToDelete)

    if (error) {
      setDeleteResidentsError(error.message)
      setDeleteResidentsSaving(false)
      return
    }

    setResidents((prev) => prev.filter((resident) => !selectedResidentIds.has(resident.id)))
    setSelectedResidentIds(new Set())
    setDeleteResidentsSaving(false)
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="flex items-start justify-between gap-3 py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Residents
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Lease status, balances, and AI-inferred sentiment across your tenant base.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddResidentError(null)
            setAddResidentOpen(true)
          }}
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
          Add resident
        </button>
      </div>

      {addResidentError ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {addResidentError}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
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
              placeholder="Search residents by name or unit…"
              className="h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-black/10 hover:bg-[#dfe0e6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
              aria-label="Search residents"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              label="All sentiments"
              options={SENTIMENT_FILTER_OPTIONS}
              value={sentimentFilter === 'all' ? '' : sentimentFilter}
              onChange={(value) =>
                setSentimentFilter(value === '' ? 'all' : (value as Sentiment))
              }
            />
            <FilterToggleGroup
              label="Sort by balance"
              value={balanceSort}
              options={[
                { value: 'desc', label: 'Highest balance' },
                { value: 'asc', label: 'Lowest balance' },
              ]}
              onChange={setBalanceSort}
            />
          </div>
        </div>
      </div>

      {deleteResidentsError ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          Could not delete selected residents: {deleteResidentsError}
        </div>
      ) : null}

      {selectedResidentCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
            <span className="font-medium">{selectedResidentCount}</span>
            {selectedResidentCount === 1 ? ' resident selected' : ' residents selected'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedResidentIds(new Set())}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={deleteResidentsSaving}
              onClick={() => void deleteSelectedResidents()}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteResidentsSaving ? 'Deleting…' : 'Delete selected'}
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
                    aria-label="Select all visible residents"
                    disabled={loading || filteredResidents.length === 0}
                    checked={allFilteredResidentsSelected}
                    indeterminate={someFilteredResidentsSelected}
                    onChange={toggleAllFilteredResidentsSelected}
                  />
                </th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Resident</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Unit</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Rent</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Move-in</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Contact</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Lease ends</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Balance</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    Loading residents…
                  </td>
                </tr>
              ) : filteredResidents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    {residents.length === 0 ? (
                      <>
                        No residents yet.{' '}
                        <Link
                          to="/admin/users"
                          className="text-tertiary underline-offset-2 hover:underline"
                        >
                          Add residents
                        </Link>{' '}
                        so Ulo can reach them.
                      </>
                    ) : (
                      'No residents match your search or filters.'
                    )}
                  </td>
                </tr>
              ) : (
                filteredResidents.map((resident) => (
                  <tr key={resident.id} className="border-b border-[#f3f4f6] last:border-b-0">
                    <td className="w-12 px-4 py-4">
                      <TableCheckbox
                        aria-label={`Select ${resident.name}`}
                        checked={selectedResidentIds.has(resident.id)}
                        onChange={() => toggleResidentSelected(resident.id)}
                      />
                    </td>
                    <td className="px-6 py-4 text-[14px] font-medium text-[#0a0a0a]">
                      {resident.name}
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">{resident.unitLabel}</td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#0a0a0a]">
                      {resident.rentLabel}
                    </td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#6a7282]">
                      {resident.moveInLabel}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        {resident.contactPhone ? (
                          <span className="text-[13px] leading-5 text-[#0a0a0a]">{resident.contactPhone}</span>
                        ) : null}
                        {resident.contactEmail ? (
                          <span className="truncate text-[12px] leading-4 text-[#6a7282]">
                            {resident.contactEmail}
                          </span>
                        ) : null}
                        {!resident.contactPhone && !resident.contactEmail ? (
                          <span className="text-[14px] text-[#6a7282]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#6a7282]">
                      {resident.leaseEndLabel}
                    </td>
                    <td
                      className={[
                        'px-6 py-4 text-[14px] tabular-nums',
                        resident.balanceDue > 0
                          ? 'font-semibold text-[#0a0a0a]'
                          : 'text-[#6a7282]',
                      ].join(' ')}
                    >
                      {formatBalance(resident.balanceDue)}
                    </td>
                    <td className="px-6 py-4">
                      <SentimentBadge sentiment={resident.sentiment} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AddResidentModal
        open={addResidentOpen}
        extraUnitOptions={unitOptions}
        onClose={() => setAddResidentOpen(false)}
        onSubmit={(payload) => {
          void addResidentFromModal(payload)
        }}
      />
    </main>
  )
}

export default AdminResidentsDashboard
