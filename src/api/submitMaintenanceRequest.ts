import type { IssueParsed } from './issueAnalysis'
import type { MaintenanceFormValues } from '../lib/maintenanceRequestValidation'
import { getValidResidentSubmitAuth } from '../lib/residentAuth'
import { supabase } from '../lib/supabase'

const ALLOWED_ISSUE_CATEGORIES = ['plumbing', 'electrical', 'appliance'] as const

function normalizeToAllowedIssueCategory(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== 'string') return null
  const c = raw.trim().toLowerCase()
  if (c === 'appliances') return 'appliance'
  if ((ALLOWED_ISSUE_CATEGORIES as readonly string[]).includes(c)) return c
  return null
}

/** Maps AI clarify `issue_category` / `issueType` to backend `issueCategory` when it matches the allowlist. */
export function safeIssueCategoryFromParsed(
  parsed: IssueParsed | null,
): string | null {
  if (!parsed) return null
  const fromStructured = normalizeToAllowedIssueCategory(parsed.issue_category)
  if (fromStructured) return fromStructured
  return normalizeToAllowedIssueCategory(parsed.issueType)
}

/** Supabase Edge Functions need `apikey` + `Authorization` (anon or user JWT). Do not set `Content-Type` for FormData. */
function maintenanceSubmitHeaders(
  targetUrl: string,
  auth?: SubmitMaintenanceAuth,
): Record<string, string> | undefined {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!anon) return undefined
  try {
    const { hostname } = new URL(targetUrl)
    if (!hostname.endsWith('.supabase.co')) return undefined
    const bearer = auth?.accessToken?.trim() || anon
    return {
      apikey: anon,
      Authorization: `Bearer ${bearer}`,
    }
  } catch {
    return undefined
  }
}

function messageFromResponseBody(text: string, status: number): string {
  const raw = text.trim()
  if (/invalid jwt/i.test(raw)) {
    return 'Sign-in could not be confirmed for this request. Please verify your email again, then submit.'
  }
  if (!text) return `Request failed (${status}).`
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string }
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    /* not JSON */
  }
  const trimmed = text.trim()
  return trimmed.length > 200 ? `Request failed (${status}).` : trimmed
}

export type SubmitMaintenanceInput = MaintenanceFormValues & {
  /** One or more image/video files; sent as repeated `photo` multipart fields. */
  photos: File[]
  /** When set (plumbing | electrical | appliance), Edge Function uses this instead of re-classifying from description. */
  issueCategory?: string | null
}

export type SubmitMaintenanceAuth = {
  accessToken: string
  residentUserId: string
}

export type SubmitMaintenanceOptions = {
  /** After Supabase email OTP; your API can validate `Authorization` and link `residentUserId`. */
  auth?: SubmitMaintenanceAuth
  /**
   * When true, `auth` was just produced by `getValidResidentSubmitAuth` — skip a second refresh before fetch.
   */
  sessionFresh?: boolean
}

export type SubmitMaintenanceResult = {
  /** Shown to the resident (may be replaced with a display reference in the form). */
  id: string
  /** Canonical id from your API for follow-ups (comments, webhooks). */
  ticketId: string
  mode: 'api' | 'demo'
}

/**
 * POSTs multipart form data when `VITE_MAINTENANCE_API_URL` is set.
 * Each `photo` part may be an image (PNG/JPG) or video (MP4/WebM/MOV).
 * Otherwise simulates success for local development (see `.env.example`).
 */
export async function submitMaintenanceRequest(
  input: SubmitMaintenanceInput,
  options?: SubmitMaintenanceOptions,
): Promise<SubmitMaintenanceResult> {
  const { photos, issueCategory, ...fields } = input

  /** Read per-call so Vite always injects current `VITE_MAINTENANCE_API_URL` (avoids stale module-scope in edge cases). */
  const apiUrl = import.meta.env.VITE_MAINTENANCE_API_URL?.trim()

  if (apiUrl) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
    if (supabaseUrl) {
      try {
        const fnHost = new URL(apiUrl).hostname
        const projectHost = new URL(supabaseUrl).hostname
        if (fnHost.endsWith('.supabase.co') && fnHost !== projectHost) {
          throw new Error(
            'VITE_MAINTENANCE_API_URL must be the same Supabase project as VITE_SUPABASE_URL, or the user JWT will be rejected (Invalid JWT).',
          )
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('VITE_MAINTENANCE')) throw e
      }
    }
    const body = new FormData()
    body.set('urgency', fields.urgency)
    body.set('residentName', fields.residentName.trim())
    body.set('email', fields.email.trim())
    const phone = fields.phone?.trim() ?? ''
    if (phone) body.set('residentPhone', phone)
    body.set(
      'residentNotificationChannel',
      fields.residentNotificationChannel ?? 'both',
    )
    body.set('unit', fields.unit.trim())
    body.set('description', fields.description.trim())
    const safeIssueCategory = normalizeToAllowedIssueCategory(issueCategory)
    if (safeIssueCategory) {
      body.set('issueCategory', safeIssueCategory)
    }
    for (const file of photos) {
      body.append('photo', file)
    }
    let authForRequest = options?.auth
    if (apiUrl && supabase) {
      if (authForRequest && !options?.sessionFresh) {
        try {
          const fresh = await getValidResidentSubmitAuth(supabase)
          authForRequest = {
            accessToken: fresh.accessToken,
            residentUserId: fresh.userId,
          }
        } catch {
          throw new Error('No active session')
        }
      } else if (!authForRequest) {
        try {
          const fresh = await getValidResidentSubmitAuth(supabase)
          authForRequest = {
            accessToken: fresh.accessToken,
            residentUserId: fresh.userId,
          }
        } catch {
          throw new Error(
            'Sign-in required. Verify your resident email, then submit again.',
          )
        }
      }
    }

    if (authForRequest?.residentUserId) {
      body.set('residentUserId', authForRequest.residentUserId)
    }

    const supabaseHeaders = maintenanceSubmitHeaders(apiUrl, authForRequest)
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: supabaseHeaders,
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(messageFromResponseBody(text, res.status))
    }

    let id = 'submitted'
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = (await res.json()) as { id?: string; requestId?: string }
      id = data.id ?? data.requestId ?? id
    }

    return { id, ticketId: id, mode: 'api' }
  }

  await new Promise((r) => setTimeout(r, 550))
  const demoId = `demo-${Date.now()}`
  return { id: demoId, ticketId: demoId, mode: 'demo' }
}
