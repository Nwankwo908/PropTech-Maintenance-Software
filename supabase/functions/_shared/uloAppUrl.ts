/// <reference lib="deno.ns" />
/**
 * Official Ulo public app URL builder for Edge Functions.
 *
 * Every feature that needs a website link should call these helpers —
 * do not concatenate APP_URL + path in feature code.
 */

export const DEFAULT_ULO_APP_ORIGIN = "https://app.ulohome.io"

export type UloAppOriginOptions = {
  /** Prefer RENT_PAYMENT_BASE_URL before APP_URL (rent Checkout return URLs). */
  preferRentBase?: boolean
  /** Browser origin from the request body (local vs production). */
  returnOrigin?: string | null
  /** HTTP Origin header from the request. */
  requestOrigin?: string | null
  /**
   * Fallback when env/request origins are empty.
   * Default: DEFAULT_ULO_APP_ORIGIN. Pass "" to allow empty (no absolute URL).
   */
  fallback?: string | null
}

/** Normalize a host or URL into `https://…` with no trailing slash. */
export function normalizeAppOrigin(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/\/$/, "")
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/**
 * Resolve the public Ulo app origin.
 * Priority: returnOrigin → requestOrigin → env (APP_URL / RENT_PAYMENT_BASE_URL) → fallback.
 */
export function uloAppOrigin(options: UloAppOriginOptions = {}): string {
  const fromBody = normalizeAppOrigin(options.returnOrigin)
  if (fromBody) return fromBody

  const fromHeader = normalizeAppOrigin(options.requestOrigin)
  if (fromHeader) return fromHeader

  const envPrimary = options.preferRentBase
    ? (Deno.env.get("RENT_PAYMENT_BASE_URL")?.trim() ||
      Deno.env.get("APP_URL")?.trim() ||
      "")
    : (Deno.env.get("APP_URL")?.trim() ||
      Deno.env.get("RENT_PAYMENT_BASE_URL")?.trim() ||
      "")
  const fromEnv = normalizeAppOrigin(envPrimary)
  if (fromEnv) return fromEnv

  if (options.fallback === "") return ""
  if (typeof options.fallback === "string") {
    return normalizeAppOrigin(options.fallback)
  }
  return DEFAULT_ULO_APP_ORIGIN
}

function joinOriginPath(origin: string, path: string): string {
  const base = origin.replace(/\/$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  if (!base) return p
  return `${base}${p}`
}

export type RentPaymentLinkParams = {
  runId: string
  residentId: string
  billingPeriod: string
  amountDue: number
  /** Extra query flags, e.g. rent_payment=success */
  query?: Record<string, string | number | boolean | null | undefined>
}

/** Named public app routes. */
export const uloAppUrl = {
  /** Absolute URL for any app path (`/admin/...`). */
  absolute(
    path: string,
    options?: UloAppOriginOptions,
  ): string {
    return joinOriginPath(uloAppOrigin(options), path)
  },

  /** Vendor verification / onboarding form. */
  vendorVerification(
    token: string,
    options?: UloAppOriginOptions & {
      connect?: "return" | "refresh" | null
    },
  ): string {
    const t = encodeURIComponent(token.trim())
    let path = `/v/${t}`
    if (options?.connect === "return" || options?.connect === "refresh") {
      path += `?connect=${options.connect}`
    }
    return joinOriginPath(uloAppOrigin(options), path)
  },

  /** Durable resident rent payment page (fallback when Stripe session unavailable). */
  rentPayment(
    params: RentPaymentLinkParams,
    options?: UloAppOriginOptions,
  ): string {
    const origin = uloAppOrigin({ preferRentBase: true, ...options })
    const url = new URL(joinOriginPath(origin || DEFAULT_ULO_APP_ORIGIN, "/pay/rent"))
    url.searchParams.set("run", params.runId)
    url.searchParams.set("resident", params.residentId)
    url.searchParams.set("period", params.billingPeriod)
    url.searchParams.set("amount", String(params.amountDue))
    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value == null) continue
        url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  },

  /** Public work-order job detail. */
  workOrder(token: string, options?: UloAppOriginOptions): string {
    return joinOriginPath(
      uloAppOrigin(options),
      `/w/${encodeURIComponent(token.trim())}`,
    )
  },

  /** Public estimate form. */
  estimate(token: string, options?: UloAppOriginOptions): string {
    return joinOriginPath(
      uloAppOrigin(options),
      `/estimate/${encodeURIComponent(token.trim())}`,
    )
  },

  /** Public invoice form. */
  invoice(token: string, options?: UloAppOriginOptions): string {
    return joinOriginPath(
      uloAppOrigin(options),
      `/invoice/${encodeURIComponent(token.trim())}`,
    )
  },

  /** Public job completion upload. */
  upload(token: string, options?: UloAppOriginOptions): string {
    return joinOriginPath(
      uloAppOrigin(options),
      `/upload/${encodeURIComponent(token.trim())}`,
    )
  },

  /** Admin dashboard deep link (default `/admin`). */
  admin(path = "", options?: UloAppOriginOptions): string {
    const trimmed = path.trim()
    const suffix = !trimmed
      ? "/admin"
      : trimmed.startsWith("/admin")
      ? trimmed.startsWith("/") ? trimmed : `/${trimmed}`
      : `/admin/${trimmed.replace(/^\//, "")}`
    return joinOriginPath(uloAppOrigin(options), suffix)
  },

  /** Overview → Find External Vendor for a work order. */
  findExternalVendor(
    ticketId: string,
    options?: UloAppOriginOptions,
  ): string {
    const id = encodeURIComponent(ticketId.trim())
    return joinOriginPath(
      uloAppOrigin(options),
      `/admin?findVendor=1&ticket=${id}`,
    )
  },

  /** Lightweight phone capture page for AI Equipment Scan. */
  inspectionCapture(
    sessionId: string,
    token: string,
    options?: UloAppOriginOptions,
  ): string {
    const origin = uloAppOrigin(options)
    const url = new URL(
      joinOriginPath(origin || DEFAULT_ULO_APP_ORIGIN, `/inspection/capture/${encodeURIComponent(sessionId.trim())}`),
    )
    url.searchParams.set("token", token.trim())
    return url.toString()
  },
}

/** @deprecated Prefer uloAppOrigin / uloAppUrl — kept for gradual migration. */
export function resolveAppUrl(fallback = DEFAULT_ULO_APP_ORIGIN): string {
  return uloAppOrigin({ fallback })
}
