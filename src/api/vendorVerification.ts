/**
 * Client wrappers for the vendor verification flow.
 *
 * - `sendVendorInvite` → admin-authorized `send-vendor-invite` Edge Function
 *   (ADMIN_REASSIGN_SECRET via `x-admin-reassign-secret`).
 * - `vendorVerificationAction` → public token-authorized `vendor-verification`
 *   Edge Function, invoked through the shared Supabase client.
 */
import { adminEdgeInvokeHeaders, fetchAdminEdgeFunction } from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'
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


function resolveEdgeUrl(fn: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) {
    throw new Error("This feature isn't available right now. Please try again later.")
  }
  return `${base}/functions/v1/${fn}`
}

export async function sendVendorInvite(
  input: SendVendorInviteInput,
): Promise<SendVendorInviteResult> {
  const secret = getAdminEdgeSecret()
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

export type InviteVendorAfterAddResult = {
  ok: boolean
  /** False when invite was skipped (no contact) or not attempted. */
  attempted: boolean
  delivery?: VendorInviteDelivery
  error?: string
}

/**
 * After a vendor is added post-onboarding: send the same verification invite
 * used at setup complete. Best-effort — never throws.
 */
export async function inviteVendorAfterAdd(params: {
  landlordId?: string
  vendorId: string
  businessName: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  tradeCategories?: string[]
  propertyName?: string | null
}): Promise<InviteVendorAfterAddResult> {
  const vendorId = params.vendorId.trim()
  if (!vendorId) {
    return { ok: false, attempted: false, error: 'Missing vendor id.' }
  }

  const phone = params.phone?.trim() ?? ''
  const email = params.email?.trim() ?? ''
  if (!phone && !email) {
    return { ok: true, attempted: false }
  }

  const channel: VendorInviteChannel =
    phone && email ? 'both' : phone ? 'sms' : 'email'

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()

  if (!landlordId) {
    return { ok: false, attempted: false, error: 'No active landlord.' }
  }

  try {
    const result = await sendVendorInvite({
      landlordId,
      vendorId,
      businessName: params.businessName.trim() || 'Vendor',
      contactName: params.contactName?.trim() || undefined,
      email: email || undefined,
      phone: phone || undefined,
      propertyName: params.propertyName?.trim() || undefined,
      channel,
      tradeCategories: params.tradeCategories,
    })
    const anySent =
      result.delivery.sms === 'sent' || result.delivery.email === 'sent'
    if (!anySent) {
      return {
        ok: false,
        attempted: true,
        delivery: result.delivery,
        error: 'Verification invite could not be delivered.',
      }
    }
    return { ok: true, attempted: true, delivery: result.delivery }
  } catch (err) {
    const message = getErrorMessage(err, 'Something went wrong. Please try again.')
    console.warn('[vendorVerification] inviteVendorAfterAdd', message)
    return { ok: false, attempted: true, error: message }
  }
}

/** Plain-language warning when roster save succeeded but invite failed. */
export function vendorInviteWarningMessage(
  result: InviteVendorAfterAddResult,
): string | null {
  if (!result.attempted) return null
  if (result.ok) return null
  if (result.error) {
    return `Vendor saved, but the verification invite could not be sent (${result.error}).`
  }
  return 'Vendor saved, but the verification invite could not be delivered.'
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

export type VendorStripePayoutMethod = {
  id: string
  kind: 'bank_account' | 'card'
  label: string
  last4: string | null
  bankName: string | null
  brand: string | null
  funding: string | null
  defaultForCurrency: boolean
  currency: string | null
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
  taxEntityType: string | null
  tinType: 'ssn' | 'ein' | null
  tinLast4: string | null
  w9Variant: 'individual' | 'business' | null
  tax1099Treatment: 'nec' | 'none' | null
  stripeConnectReady: boolean
  payoutMethods: VendorStripePayoutMethod[]
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
  /** Legal entity — drives SSN vs EIN, W-9 variant, and 1099 treatment. */
  taxEntityType?:
    | 'sole_proprietor'
    | 'llc'
    | 'corporation'
    | 'partnership'
    | 'other'
  /** Full TIN digits (or formatted); only last4 + fingerprint are stored. */
  tin?: string
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
    | 'create_connect_account_link'
    | 'refresh_connect_status'
    | 'submit'
  patch?: VendorVerificationPatch
  licenseState?: string
  licenseNumber?: string
  kind?: 'license' | 'coi' | 'w9'
  fileName?: string
  contentType?: string
  dataBase64?: string
  returnOrigin?: string
}

function parsePayoutMethod(raw: unknown): VendorStripePayoutMethod | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const kind = row.kind === 'bank_account' || row.kind === 'card' ? row.kind : null
  const label = typeof row.label === 'string' ? row.label.trim() : ''
  if (!id || !kind || !label) return null
  return {
    id,
    kind,
    label,
    last4: typeof row.last4 === 'string' ? row.last4 : null,
    bankName: typeof row.bankName === 'string' ? row.bankName : null,
    brand: typeof row.brand === 'string' ? row.brand : null,
    funding: typeof row.funding === 'string' ? row.funding : null,
    defaultForCurrency: row.defaultForCurrency === true,
    currency: typeof row.currency === 'string' ? row.currency : null,
  }
}

function normalizeSession(session: VendorVerificationSession): VendorVerificationSession {
  const methodsRaw = Array.isArray(session.payoutMethods) ? session.payoutMethods : []
  const payoutMethods = methodsRaw
    .map(parsePayoutMethod)
    .filter((m): m is VendorStripePayoutMethod => m != null)
  return {
    ...session,
    payoutMethods,
  }
}

async function invokeVendorVerification(
  body: VendorVerificationBody,
): Promise<{
  session: VendorVerificationSession
  overall?: 'verified' | 'needs_review'
  url?: string
}> {
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
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
    throw new Error(
      getErrorMessage(message, "We couldn't complete that request. Please try again."),
    )
  }
  const payload = data as {
    ok?: boolean
    session?: VendorVerificationSession
    overall?: 'verified' | 'needs_review'
    url?: string
    error?: string
  }
  if (!payload?.session) {
    throw new Error(
      getErrorMessage(
        payload?.error,
        "We couldn't load your verification form. Please refresh and try again.",
      ),
    )
  }
  return {
    session: normalizeSession(payload.session),
    overall: payload.overall,
    url: typeof payload.url === 'string' ? payload.url : undefined,
  }
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

/** Start Stripe Express Connect onboarding; returns hosted Account Link URL. */
export function createVendorConnectAccountLink(token: string) {
  const returnOrigin =
    typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : undefined
  return invokeVendorVerification({
    token,
    action: 'create_connect_account_link',
    ...(returnOrigin ? { returnOrigin } : {}),
  })
}

/** Sync Connect charges/payouts flags after Stripe return or refresh. */
export function refreshVendorConnectStatus(token: string) {
  return invokeVendorVerification({ token, action: 'refresh_connect_status' })
}

/** Primary masked payout destination for confirmation copy. */
export function primaryVendorPayoutMethodLabel(
  session: VendorVerificationSession | null | undefined,
): string | null {
  if (!session?.payoutMethods?.length) return null
  const preferred =
    session.payoutMethods.find((m) => m.defaultForCurrency) ?? session.payoutMethods[0]
  return preferred?.label?.trim() || null
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
