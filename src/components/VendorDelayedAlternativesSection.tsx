import { useEffect, useState } from 'react'
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  type AdminVendorReassignChoice,
} from '@/api/adminReassignVendor'
import { VendorDelayedAlternativesCard } from '@/components/VendorDelayedAlternativesCard'
import {
  getIssueCategorySlugForTicket,
  vendorMatchesTicketIssueCategory,
} from '@/lib/vendorIssueCategory'
import {
  isVendorPendingAcceptDelayed,
  vendorAutoReassignDeadlineLabel,
} from '@/lib/vendorDelayAlerts'

export type VendorDelayRowInput = {
  id: string
  backendTicketId?: string
  vendor?: string
  vendorWorkStatus?: string | null
  assignedAtIso?: string | null
  issueCategoryRaw?: string | null
  category: string
}

type VendorPickerRow = { id?: string; name: string; category: string | null }

/** Full URL to `recommend-vendor-alternatives`; explicit env or `${VITE_SUPABASE_URL}/functions/v1/...`. */
function resolveVendorRecommendAlternativesUrl(): string | undefined {
  const explicit = import.meta.env.VITE_VENDOR_RECOMMEND_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  if (base) return `${base}/functions/v1/recommend-vendor-alternatives`
  return undefined
}

function uniqueVendorStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = raw?.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function heuristicAlternativeNames(
  row: VendorDelayRowInput,
  activeVendorsFromDb: VendorPickerRow[],
): string[] {
  const slug = getIssueCategorySlugForTicket(row)
  const fromDb =
    slug != null
      ? activeVendorsFromDb
          .filter((v) => vendorMatchesTicketIssueCategory(v.category, slug))
          .map((v) => v.name.trim())
          .filter(Boolean)
      : []
  const current = row.vendor?.trim() ?? ''
  return uniqueVendorStrings(fromDb).filter((n) => n !== current)
}

type VendorDelayedAlternativesSectionProps = {
  row: VendorDelayRowInput
  activeVendorsFromDb: VendorPickerRow[]
  staticFallbackNames?: string[]
  onReassignVendor: (choice: AdminVendorReassignChoice) => Promise<void>
}

export function VendorDelayedAlternativesSection({
  row,
  activeVendorsFromDb,
  staticFallbackNames,
  onReassignVendor,
}: VendorDelayedAlternativesSectionProps) {
  const [candidates, setCandidates] = useState<{ id?: string; name: string }[]>(
    [],
  )
  const ticketId = row.backendTicketId?.trim() || ''
  const recommendUrl = resolveVendorRecommendAlternativesUrl()
  const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
  const vws = (row.vendorWorkStatus ?? '').trim().toLowerCase()
  const delayed = isVendorPendingAcceptDelayed(
    row.vendorWorkStatus,
    row.assignedAtIso,
  )
  const staticKey = staticFallbackNames?.join('\u0001') ?? ''

  const apiEligible =
    vws === 'pending_accept' &&
    delayed &&
    Boolean(ticketId && recommendUrl && secret)

  const [loading, setLoading] = useState(apiEligible)
  const [err, setErr] = useState<string | null>(null)
  /** True after `recommend-vendor-alternatives` returned 200 (use `alternatives[]` as-is). */
  const [alternativesFromApi, setAlternativesFromApi] = useState(false)

  useEffect(() => {
    const heur = heuristicAlternativeNames(row, activeVendorsFromDb).map(
      (name) => {
        const hit = activeVendorsFromDb.find((v) => v.name.trim() === name)
        return {
          name,
          ...(hit?.id?.trim() ? { id: hit.id.trim() } : {}),
        }
      },
    )
    const staticList =
      staticFallbackNames?.filter(Boolean).map((name) => ({ name })) ?? []

    if (apiEligible) {
      let cancelled = false
      setCandidates([])
      setAlternativesFromApi(false)
      setLoading(true)
      setErr(null)
      void (async () => {
        try {
          const res = await fetchAdminEdgeFunction(recommendUrl!, {
            method: 'POST',
            headers: adminEdgeInvokeHeaders(secret!),
            body: JSON.stringify({
              ticketId,
            }),
          })
          const text = await res.text()
          let body: unknown
          try {
            body = text ? JSON.parse(text) : {}
          } catch {
            throw new Error(
              `Vendor recommendations: invalid JSON (${res.status})`,
            )
          }
          if (!res.ok) {
            const errBody = body as { error?: string }
            const base =
              errBody.error ??
              `Vendor recommendations failed (${res.status})`
            if (
              res.status === 401 &&
              String(errBody.error ?? '').toLowerCase() === 'unauthorized'
            ) {
              throw new Error(
                `${base} (401): set Edge ADMIN_REASSIGN_SECRET to the same value as VITE_ADMIN_REASSIGN_SECRET.`,
              )
            }
            throw new Error(base)
          }
          const data = body as {
            alternatives?: { id: string; name: string }[]
          }
          const alts = Array.isArray(data.alternatives)
            ? data.alternatives
            : []
          if (cancelled) return
          setAlternativesFromApi(true)
          setCandidates(alts.map((a) => ({ id: a.id, name: a.name })))
        } catch (e) {
          if (cancelled) return
          setAlternativesFromApi(false)
          setErr(
            e instanceof Error ? e.message : 'Could not load suggestions',
          )
          setCandidates(heur.length > 0 ? heur : staticList)
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    setLoading(false)
    setErr(null)
    setAlternativesFromApi(false)
    setCandidates(staticList.length > 0 ? staticList : heur)
    return undefined
  }, [
    activeVendorsFromDb,
    apiEligible,
    delayed,
    recommendUrl,
    row.id,
    row.backendTicketId,
    row.vendorWorkStatus,
    row.assignedAtIso,
    row.issueCategoryRaw,
    row.category,
    row.vendor,
    secret,
    staticKey,
    ticketId,
    vws,
  ])

  const deadline = vendorAutoReassignDeadlineLabel(row.assignedAtIso ?? null)

  return (
    <VendorDelayedAlternativesCard
      candidates={candidates}
      loading={loading}
      alternativesFromApi={alternativesFromApi}
      errorMessage={err}
      autoDeadlineLabel={deadline}
      onSelectVendor={onReassignVendor}
    />
  )
}
