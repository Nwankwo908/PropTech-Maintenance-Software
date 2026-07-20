/**
 * Client wrappers for the vendor verification flow.
 *
 * - `sendVendorInvite` → admin-authorized `send-vendor-invite` Edge Function
 *   (ADMIN_REASSIGN_SECRET via `x-admin-reassign-secret`).
 * - `vendorVerificationAction` → public token-authorized `vendor-verification`
 *   Edge Function, invoked through the shared Supabase client.
 */
import { supabase } from '@/lib/supabase'
import { adminEdgeInvokeHeaders, fetchAdminEdgeFunction } from '@/api/adminReassignVendor'
import type { VerificationChecklist } from '@/lib/vendorVerificationChecklist'

export type VendorInviteChannel = 'sms' | 'email' | 'both'

export type SendVendorInviteInput = {
  landlordId: string
  vendorId?: string | null
  businessName?: string
  contactName?: string
  vendorFirstName?: string
  email?: string
  phone?: string
  propertyName?: string
  channel: VendorInviteChannel
  tradeCategories?: string[]
}

export type VendorInviteDelivery = {
  sms: 'sent' | 'skipped' | 'failed' | null
  email: 'sent' | 'skipped' | 'failed' | null
  smsError?: string
  emailError?: string
}

export type SendVendorInviteResult = {
  ok: boolean
  verificationId: string
  token: string
  link: string
  delivery: VendorInviteDelivery
}

function adminSecret(): string {
  const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
  if (!secret) throw new Error('Missing VITE_ADMIN_REASSIGN_SECRET configuration')
  return secret
}

function resolveEdgeUrl(fn: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) throw new Error('Missing VITE_SUPABASE_URL configuration')
  return `${base}/functions/v1/${fn}`
}

export async function sendVendorInvite(
  input: SendVendorInviteInput,
): Promise<SendVendorInviteResult> {
  const secret = adminSecret()
  const url = resolveEdgeUrl('send-vendor-invite')
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify(input),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Vendor invite: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = parsed as { error?: string }
    throw new Error(err.error ?? `Vendor invite failed (${res.status})`)
  }
  return parsed as SendVendorInviteResult
}

// --- Vendor portal (token-authorized) ---------------------------------------

export type VendorVerificationDocument = {
  id: string
  kind: 'license' | 'coi' | 'w9'
  fileName: string | null
  contentType: string | null
  uploadedAt: string
  parsed: Record<string, unknown>
}

export type VendorVerificationSession = {
  status: 'invited' | 'in_progress' | 'submitted' | 'verified' | 'needs_review'
  businessName: string | null
  contactName: string | null
  vendorFirstName: string | null
  email: string | null
  phone: string | null
  propertyName: string | null
  license: {
    state: string | null
    number: string | null
    type: string | null
    status: string | null
  }
  insurance: {
    generalLiability: number | null
    expiration: string | null
    additionalInsured: boolean
    status: string | null
  }
  backgroundCheck: {
    status: string | null
    ref: string | null
  }
  w9Received: boolean
  tradeCategories: string[]
  serviceArea: {
    zips?: string[]
    cities?: string[]
    counties?: string[]
    radiusMiles?: number | null
    centerAddress?: string | null
  }
  availability: 'active' | 'paused'
  progress: Record<string, unknown>
  documents: VendorVerificationDocument[]
  checklist: VerificationChecklist
}

export type VendorVerificationPatch = {
  businessName?: string
  contactName?: string
  vendorFirstName?: string
  email?: string
  phone?: string
  propertyName?: string
  tradeCategories?: string[]
  serviceArea?: VendorVerificationSession['serviceArea']
  availability?: 'active' | 'paused'
  progress?: Record<string, unknown>
}

type VendorVerificationBody = {
  token: string
  action:
    | 'resolve'
    | 'save'
    | 'verifyLicense'
    | 'upload'
    | 'startBackgroundCheck'
    | 'backgroundStatus'
    | 'submit'
  patch?: VendorVerificationPatch
  licenseState?: string
  licenseNumber?: string
  kind?: 'license' | 'coi' | 'w9'
  fileName?: string
  contentType?: string
  dataBase64?: string
}

async function invokeVendorVerification(
  body: VendorVerificationBody,
): Promise<{ session: VendorVerificationSession; overall?: 'verified' | 'needs_review' }> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  const { data, error } = await supabase.functions.invoke('vendor-verification', { body })
  if (error) {
    // Try to surface the JSON error body when available.
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const t = await ctx.text()
        const j = t ? (JSON.parse(t) as { error?: string }) : null
        if (j?.error) message = j.error
      } catch {
        /* ignore */
      }
    }
    throw new Error(message)
  }
  const payload = data as {
    ok?: boolean
    session?: VendorVerificationSession
    overall?: 'verified' | 'needs_review'
    error?: string
  }
  if (!payload?.session) {
    throw new Error(payload?.error ?? 'Vendor verification: empty response')
  }
  return { session: payload.session, overall: payload.overall }
}

export function resolveVendorVerification(token: string) {
  return invokeVendorVerification({ token, action: 'resolve' })
}

export function saveVendorVerification(token: string, patch: VendorVerificationPatch) {
  return invokeVendorVerification({ token, action: 'save', patch })
}

export function verifyVendorLicense(
  token: string,
  input: { licenseState?: string; licenseNumber?: string },
) {
  return invokeVendorVerification({
    token,
    action: 'verifyLicense',
    licenseState: input.licenseState,
    licenseNumber: input.licenseNumber,
  })
}

export function uploadVendorDocument(
  token: string,
  input: { kind: 'license' | 'coi' | 'w9'; fileName: string; contentType: string; dataBase64: string },
) {
  return invokeVendorVerification({ token, action: 'upload', ...input })
}

export function startVendorBackgroundCheck(token: string) {
  return invokeVendorVerification({ token, action: 'startBackgroundCheck' })
}

export function refreshVendorBackgroundStatus(token: string) {
  return invokeVendorVerification({ token, action: 'backgroundStatus' })
}

export function submitVendorVerification(token: string, patch?: VendorVerificationPatch) {
  return invokeVendorVerification({ token, action: 'submit', patch })
}

/** Read a File into a base64 string (data URL prefix stripped server-side). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Could not read file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}
