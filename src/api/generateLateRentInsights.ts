/**
 * POST generate-late-rent-insights (ADMIN_REASSIGN_SECRET via x-admin-reassign-secret).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import type { LateRentInsightTag } from '@/lib/lateRentAccountReview'

export type LateRentInsightsAccountDto = {
  residentName: string
  locationLabel: string
  daysOverdue: number
  balanceDue: number | null
  monthlyRent: number | null
  workflowStatus: string
  rentClassification: string | null
  paymentIntent: string | null
  paymentStatus: string | null
  reminderSent: boolean
  reminderSmsSent: boolean
  reminderEmailSent: boolean
  leaseStatus: string | null
  moveInDate: string | null
  riskLevel: 'low' | 'medium' | 'high'
}

export type GenerateLateRentInsightsOk = {
  insights: Array<{ tag: LateRentInsightTag; text: string }>
  mode: 'openai' | 'fallback'
}

export function resolveGenerateLateRentInsightsUrl(): string | null {
  const explicit = import.meta.env.VITE_LATE_RENT_INSIGHTS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/generate-late-rent-insights`
  return null
}

export async function postGenerateLateRentInsights(input: {
  url: string
  secret: string
  account: LateRentInsightsAccountDto
}): Promise<GenerateLateRentInsightsOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('Late rent insights: missing URL or secret')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({ account: input.account }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Late rent insights: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `Late rent insights failed (${res.status})`)
  }
  return body as GenerateLateRentInsightsOk
}
