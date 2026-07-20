import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { parseVendorId } from '@/lib/vendorRoutes'
import {
  buildVendorComplianceProfile,
  type VendorComplianceItem,
  type VendorComplianceProfile,
} from '@/lib/vendorComplianceProfile'
import {
  computeVerificationChecklist,
  type VerificationChecklist,
  type VerificationChecklistItem,
  type VerificationItemStatus,
  type VerificationRecord,
} from '@/lib/vendorVerificationChecklist'

type VendorRecord = {
  id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  active: boolean
}

type VendorMetrics = {
  rating: number | null
  reviewCount: number
  completedJobs: number
  avgResponseMinutes: number | null
  residentSatisfaction: number | null
  completionRate: number | null
}

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

function formatResponse(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`
  return `${Math.round(hours / 24)} d`
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">{label}</p>
      <p className="mt-2 text-[24px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums">
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[12px] leading-4 text-[#6a7282]">{sub}</p> : null}
    </div>
  )
}

function ComplianceCard({ item }: { item: VendorComplianceItem }) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
          {item.label}
        </p>
        <span
          className={[
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
            item.collected ? 'bg-[#dbfce7] text-[#008236]' : 'bg-[#f3f4f6] text-[#6a7282]',
          ].join(' ')}
        >
          {item.collected ? 'On file' : 'Not collected'}
        </span>
      </div>
      {item.collected ? (
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-[#00a63e]" aria-hidden />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{item.headline}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-[#364153]">{item.detail}</p>
            {item.meta ? (
              <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{item.meta}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full border border-[#d1d5dc]" aria-hidden />
          <p className="text-[13px] leading-5 text-[#6a7282]">{item.emptyHint}</p>
        </div>
      )}
    </div>
  )
}

function checklistStatusStyle(status: VerificationItemStatus): { dot: string; pill: string; label: string } {
  switch (status) {
    case 'complete':
      return { dot: 'bg-[#00a63e]', pill: 'bg-[#dbfce7] text-[#008236]', label: 'Verified' }
    case 'action_needed':
      return { dot: 'bg-[#dc2626]', pill: 'bg-[#fee2e2] text-[#b91c1c]', label: 'Action needed' }
    case 'pending':
      return { dot: 'bg-[#d97706]', pill: 'bg-[#fef9c3] text-[#92400e]', label: 'Pending' }
    default:
      return { dot: 'bg-[#d1d5dc]', pill: 'bg-[#f3f4f6] text-[#6a7282]', label: 'Not collected' }
  }
}

function ChecklistRow({ item }: { item: VerificationChecklistItem }) {
  const style = checklistStatusStyle(item.status)
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-[#0a0a0a]">{item.label}</p>
          <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{item.detail}</p>
        </div>
      </div>
      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${style.pill}`}>
        {style.label}
      </span>
    </li>
  )
}

export function AdminVendorDetailDashboard() {
  const { vendorId: vendorSlug } = useParams<{ vendorId: string }>()
  const vendorId = parseVendorId(vendorSlug)

  const [vendor, setVendor] = useState<VendorRecord | null>(null)
  const [metrics, setMetrics] = useState<VendorMetrics | null>(null)
  const [verification, setVerification] = useState<VerificationRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadVendor = useCallback(async () => {
    if (!supabase || !vendorId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    const [vendorResult, scoresResult, verificationResult] = await Promise.allSettled([
      supabase
        .from('vendors')
        .select('id, name, category, active, email, phone')
        .eq('landlord_id', landlordId)
        .eq('id', vendorId)
        .maybeSingle(),
      supabase.rpc('get_vendor_scores_for_landlord', { p_landlord_id: landlordId }),
      supabase
        .from('vendor_verifications')
        .select(
          'license_status, license_number, license_state, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, w9_received, trade_categories, service_area, availability, status',
        )
        .eq('landlord_id', landlordId)
        .eq('vendor_id', vendorId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (vendorResult.status !== 'fulfilled' || vendorResult.value.error) {
      const message =
        vendorResult.status === 'fulfilled'
          ? vendorResult.value.error?.message
          : String(vendorResult.reason)
      setError(message ?? 'Failed to load vendor.')
      setVendor(null)
      setLoading(false)
      return
    }

    const raw = vendorResult.value.data as Record<string, unknown> | null
    if (!raw) {
      setVendor(null)
      setLoading(false)
      return
    }

    setVendor({
      id: asString(raw.id),
      name: asString(raw.name) || 'Unnamed vendor',
      category: asString(raw.category) || null,
      email: asString(raw.email) || null,
      phone: asString(raw.phone) || null,
      active: raw.active !== false,
    })

    if (scoresResult.status === 'fulfilled' && !scoresResult.value.error) {
      const match = ((scoresResult.value.data ?? []) as Record<string, unknown>[]).find(
        (row) => asString(row.vendor_id) === vendorId,
      )
      if (match) {
        setMetrics({
          rating: asFiniteNumber(match.vendor_score),
          reviewCount: asFiniteNumber(match.review_count) ?? 0,
          completedJobs: asFiniteNumber(match.completed_jobs) ?? 0,
          avgResponseMinutes: asFiniteNumber(match.avg_response_time),
          residentSatisfaction: asFiniteNumber(match.resident_satisfaction),
          completionRate: asFiniteNumber(match.completion_rate),
        })
      } else {
        setMetrics(null)
      }
    }

    if (verificationResult.status === 'fulfilled' && !verificationResult.value.error) {
      const vRaw = verificationResult.value.data as Record<string, unknown> | null
      setVerification(vRaw ? (vRaw as unknown as VerificationRecord) : null)
    } else {
      setVerification(null)
    }

    setLoading(false)
  }, [vendorId])

  useEffect(() => {
    void loadVendor()
  }, [loadVendor])

  const compliance: VendorComplianceProfile | null = useMemo(() => {
    if (!vendor) return null
    return buildVendorComplianceProfile(
      {
        id: vendor.id,
        name: vendor.name,
        phone: vendor.phone,
        category: vendor.category,
        active: vendor.active,
      },
      verification,
    )
  }, [vendor, verification])

  const checklist: VerificationChecklist | null = useMemo(() => {
    if (!verification) return null
    return computeVerificationChecklist(verification)
  }, [verification])

  if (!loading && !vendor) {
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">
          {error ? `Could not load vendor: ${error}` : 'Vendor not found.'}
        </p>
        <Link to="/admin/vendors" className="mt-3 text-[14px] font-medium text-[#186179]">
          ← All vendors
        </Link>
      </main>
    )
  }

  const tradeLabel = vendor ? formatVendorTradeLabel(vendor.category) : ''

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <Link
          to="/admin/vendors"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] transition-colors hover:text-[#101828]"
        >
          <span aria-hidden>←</span> All vendors
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              {loading ? 'Loading vendor…' : vendor?.name}
            </h1>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              {loading
                ? ' '
                : [tradeLabel, vendor?.phone, vendor?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {compliance ? (
              <span
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                  compliance.capacity.status === 'active'
                    ? 'bg-[#dbfce7] text-[#008236]'
                    : compliance.capacity.status === 'pending'
                      ? 'bg-[#fef9c3] text-[#92400e]'
                      : 'bg-[#f3f4f6] text-[#6a7282]',
                ].join(' ')}
              >
                <span
                  className={`inline-block size-2 rounded-full ${
                    compliance.capacity.status === 'active'
                      ? 'bg-[#00a63e]'
                      : compliance.capacity.status === 'pending'
                        ? 'bg-[#d97706]'
                        : 'bg-[#9ca3af]'
                  }`}
                  aria-hidden
                />
                {compliance.capacity.label}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-center text-[13px] text-[#6a7282]">Loading vendor profile…</p>
        </div>
      ) : compliance && vendor ? (
        <div className="flex flex-col gap-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Rating"
              value={metrics?.rating != null ? metrics.rating.toFixed(1) : '—'}
              sub={metrics ? `${metrics.reviewCount.toLocaleString()} reviews` : undefined}
            />
            <StatTile label="Completed jobs" value={String(metrics?.completedJobs ?? 0)} />
            <StatTile label="Avg response" value={formatResponse(metrics?.avgResponseMinutes ?? null)} />
            <StatTile
              label="Compliance"
              value={`${compliance.collectedCount}/${compliance.totalRequirements}`}
              sub="documents on file"
            />
          </div>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                Compliance & verification
              </h2>
              {checklist ? (
                <span
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                    checklist.overall === 'verified'
                      ? 'bg-[#dbfce7] text-[#008236]'
                      : 'bg-[#fef9c3] text-[#92400e]',
                  ].join(' ')}
                >
                  {checklist.overall === 'verified'
                    ? `Verified · ${checklist.completeCount}/${checklist.requiredCount}`
                    : `Needs review · ${checklist.completeCount}/${checklist.requiredCount}`}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              License, insurance, background, and tax documents Ulo keeps on file before dispatching work.
            </p>
            {checklist ? (
              <>
                <div className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                  <ul className="divide-y divide-[#f3f4f6]">
                    {checklist.items.map((item) => (
                      <ChecklistRow key={item.id} item={item} />
                    ))}
                  </ul>
                </div>
                <p className="mt-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[11px] leading-4 text-[#92400e]">
                  Demo note: license, insurance, and background results are simulated, not live
                  checks against the state board, insurance carrier, or Checkr.
                </p>
              </>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <ComplianceCard item={compliance.stateLicense} />
                <ComplianceCard item={compliance.generalLiabilityCoi} />
                <ComplianceCard item={compliance.backgroundCheck} />
                <ComplianceCard item={compliance.w9} />
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
                Trade categories
              </p>
              {compliance.tradeCategories.set ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {compliance.tradeCategories.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex rounded-full bg-[#eef2ff] px-3 py-1 text-[13px] font-medium text-[#3730a3]"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[13px] leading-5 text-[#6a7282]">
                  {compliance.tradeCategories.emptyHint}
                </p>
              )}
            </div>

            <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
                Service area
              </p>
              {compliance.serviceArea.set ? (
                <>
                  <p className="mt-3 text-[15px] font-semibold leading-5 text-[#0a0a0a]">
                    {compliance.serviceArea.primaryMetro}
                  </p>
                  {compliance.serviceArea.radiusMiles != null ? (
                    <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">
                      {compliance.serviceArea.radiusMiles} mi service radius
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {compliance.serviceArea.zipCodes.map((zip) => (
                      <span
                        key={zip}
                        className="inline-flex rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[#364153]"
                      >
                        {zip}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[13px] leading-5 text-[#6a7282]">
                  {compliance.serviceArea.emptyHint}
                </p>
              )}
            </div>

            <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
                Capacity status
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`inline-block size-2.5 rounded-full ${
                    compliance.capacity.status === 'active'
                      ? 'bg-[#00a63e]'
                      : compliance.capacity.status === 'pending'
                        ? 'bg-[#d97706]'
                        : 'bg-[#9ca3af]'
                  }`}
                  aria-hidden
                />
                <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">
                  {compliance.capacity.label}
                </p>
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-[#6a7282]">{compliance.capacity.detail}</p>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default AdminVendorDetailDashboard
