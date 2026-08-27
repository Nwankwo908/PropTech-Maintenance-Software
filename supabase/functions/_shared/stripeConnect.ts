/**
 * Stripe Connect helpers for vendor and landlord payouts (embedded onboarding).
 * Uses the platform STRIPE_SECRET_KEY (same as invoice / rent Checkout).
 *
 * Rent (tenant → landlord) and invoice (landlord → vendor) stay separate
 * checkout flows. Shared readiness / destination loading lives here.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { normalizeAppOrigin, uloAppOrigin } from "./uloAppUrl.ts"

export type StripeConnectAccountSnapshot = {
  id: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

/** Normalized Connect destination for Checkout (landlord or vendor). */
export type StripeConnectDestination = {
  accountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

/** Masked payout destination for landlord confirmation (never full account numbers). */
export type StripeConnectPayoutMethod = {
  id: string
  kind: "bank_account" | "card"
  label: string
  last4: string | null
  bankName: string | null
  brand: string | null
  funding: string | null
  defaultForCurrency: boolean
  currency: string | null
}

function stripeSecret(): string {
  return Deno.env.get("STRIPE_SECRET_KEY")?.trim() ?? ""
}

/** Publishable key for Connect.js (`pk_test_…` / `pk_live_…`). Not secret. */
export function stripePublishableKeyFromEnv(): string {
  for (const key of ["STRIPE_PUBLISHABLE_KEY", "VITE_STRIPE_PUBLISHABLE_KEY"] as const) {
    const value = Deno.env.get(key)?.trim() ?? ""
    if (value.startsWith("pk_")) return value
  }
  return ""
}

export function applicationFeeCents(amountCents: number): number {
  const raw = Deno.env.get("STRIPE_CONNECT_APPLICATION_FEE_BPS")?.trim() ?? ""
  const bps = Number.parseInt(raw, 10)
  if (!Number.isFinite(bps) || bps <= 0) return 0
  const fee = Math.floor((amountCents * bps) / 10_000)
  // Leave at least $0.50 for the destination when fee is configured.
  return Math.min(fee, Math.max(0, amountCents - 50))
}

export type StripeApiResult = {
  ok: boolean
  status: number
  json: Record<string, unknown>
}

export async function stripeForm(
  path: string,
  params: URLSearchParams,
): Promise<StripeApiResult> {
  const key = stripeSecret()
  if (!key) {
    return { ok: false, status: 503, json: { error: { message: "Stripe is not configured" } } }
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export async function stripeGet(path: string): Promise<StripeApiResult> {
  const key = stripeSecret()
  if (!key) {
    return { ok: false, status: 503, json: { error: { message: "Stripe is not configured" } } }
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export async function stripeDelete(path: string): Promise<StripeApiResult> {
  const key = stripeSecret()
  if (!key) {
    return { ok: false, status: 503, json: { error: { message: "Stripe is not configured" } } }
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export function stripeErrorMessage(json: Record<string, unknown>): string {
  const err = json.error as { message?: string; code?: string } | undefined
  const message = err?.message?.trim() || "Stripe request failed"
  // Platform account has not completed Connect signup in the Stripe Dashboard.
  if (
    /signed up for Connect/i.test(message) ||
    /connect\.stripe\.com|dashboard\.stripe\.com\/connect/i.test(message)
  ) {
    return (
      "Stripe Connect is not enabled for this Ulo Stripe account yet. " +
      "In the Stripe Dashboard, open Connect and complete platform setup " +
      "(https://dashboard.stripe.com/test/connect/accounts/overview for test mode, " +
      "or https://dashboard.stripe.com/connect/accounts/overview for live), " +
      "then try Set up payouts again."
    )
  }
  if (/Livemode requests must always be redirected via HTTPS/i.test(message)) {
    return connectHttpsRequiredMessage()
  }
  return message
}

/** True when STRIPE_SECRET_KEY is a live key (`sk_live_…`). */
export function isStripeLiveMode(): boolean {
  return stripeSecret().startsWith("sk_live_")
}

export function connectHttpsRequiredMessage(): string {
  return (
    "Stripe live mode requires HTTPS return URLs. " +
    "Local http://localhost cannot complete live payout setup. " +
    "Use a sk_test_ Stripe key for local development, or set the APP_URL Edge secret " +
    "to your https:// production site and open payout setup from that site."
  )
}

/**
 * Resolve Connect return/refresh base URL.
 * Prefer the browser origin the user started from (local vs production).
 * Delegates to shared `uloAppOrigin` (empty if unresolved — caller must error).
 *
 * Live Stripe keys cannot use http:// return URLs — when the browser origin is
 * http (e.g. localhost), fall back to https APP_URL / RENT_PAYMENT_BASE_URL.
 */
export function resolveConnectAppBaseUrl(options?: {
  returnOrigin?: string | null
  requestOrigin?: string | null
}): string {
  const preferred = uloAppOrigin({
    returnOrigin: options?.returnOrigin,
    requestOrigin: options?.requestOrigin,
    fallback: "",
  })

  if (!isStripeLiveMode()) return preferred
  if (preferred.startsWith("https://")) return preferred

  const envHttps = normalizeHttpsEnvOrigin()
  if (envHttps) return envHttps

  return preferred
}

function normalizeHttpsEnvOrigin(): string {
  for (const key of ["APP_URL", "RENT_PAYMENT_BASE_URL"] as const) {
    const raw = Deno.env.get(key)?.trim() ?? ""
    const origin = normalizeAppOrigin(raw)
    if (origin.startsWith("https://")) return origin
  }
  return ""
}

/** Validate Connect return base before calling Stripe Account Links. */
export function assertConnectReturnOriginForStripe(
  base: string,
): { ok: true } | { ok: false; error: string } {
  const origin = base.trim().replace(/\/$/, "")
  if (!origin) {
    return {
      ok: false,
      error:
        "Could not determine Connect return URL. Open payout setup from the app, or set the APP_URL Edge secret.",
    }
  }
  if (isStripeLiveMode() && !origin.startsWith("https://")) {
    return { ok: false, error: connectHttpsRequiredMessage() }
  }
  return { ok: true }
}

function snapshotFromAccount(json: Record<string, unknown>): StripeConnectAccountSnapshot | null {
  const id = typeof json.id === "string" ? json.id.trim() : ""
  if (!id.startsWith("acct_")) return null
  return {
    id,
    chargesEnabled: json.charges_enabled === true,
    payoutsEnabled: json.payouts_enabled === true,
    detailsSubmitted: json.details_submitted === true,
  }
}

/** True when the account can use fully in-app onboarding (no Stripe OTP / Express Dashboard). */
export function isEmbeddedNoDashboardConnectAccount(
  json: Record<string, unknown>,
): boolean {
  const controller = json.controller
  if (!controller || typeof controller !== "object") return false
  const row = controller as Record<string, unknown>
  const dashboard = row.stripe_dashboard
  const dashboardType =
    dashboard && typeof dashboard === "object"
      ? (dashboard as Record<string, unknown>).type
      : null
  return dashboardType === "none" && row.requirement_collection === "application"
}

export async function createExpressConnectAccount(params: {
  landlordId: string
  /** When set, stored as metadata.vendor_id (vendor onboarding). */
  vendorId?: string | null
  email?: string | null
  businessName?: string | null
}): Promise<
  | { ok: true; account: StripeConnectAccountSnapshot }
  | { ok: false; error: string }
> {
  const body = new URLSearchParams()
  // No Stripe Dashboard — required so Account Onboarding stays in Ulo (no OTP on connect.stripe.com).
  body.set("controller[fees][payer]", "application")
  body.set("controller[losses][payments]", "application")
  body.set("controller[requirement_collection]", "application")
  body.set("controller[stripe_dashboard][type]", "none")
  body.set("country", "US")
  body.set("capabilities[card_payments][requested]", "true")
  body.set("capabilities[transfers][requested]", "true")
  body.set("business_type", "company")
  body.set("metadata[landlord_id]", params.landlordId)
  const vendorId = params.vendorId?.trim()
  if (vendorId) body.set("metadata[vendor_id]", vendorId)
  body.set(
    "metadata[entity_type]",
    vendorId ? "vendor" : "landlord",
  )
  const email = params.email?.trim()
  if (email?.includes("@")) body.set("email", email)
  const name = params.businessName?.trim()
  if (name) body.set("business_profile[name]", name.slice(0, 100))

  const created = await stripeForm("accounts", body)
  if (!created.ok) {
    return { ok: false, error: stripeErrorMessage(created.json) }
  }
  const account = snapshotFromAccount(created.json)
  if (!account) return { ok: false, error: "Stripe did not return a Connect account id" }
  return { ok: true, account }
}

/**
 * Reuse an in-app Connect account, or replace an Express account that would
 * send the user to Stripe for OTP ("Add information").
 */
export async function ensureEmbeddedConnectAccount(params: {
  existingAccountId?: string | null
  landlordId: string
  vendorId?: string | null
  email?: string | null
  businessName?: string | null
}): Promise<
  | { ok: true; account: StripeConnectAccountSnapshot; replaced: boolean }
  | { ok: false; error: string }
> {
  const existing = params.existingAccountId?.trim() ?? ""
  if (existing.startsWith("acct_")) {
    const got = await stripeGet(`accounts/${encodeURIComponent(existing)}`)
    if (got.ok && isEmbeddedNoDashboardConnectAccount(got.json)) {
      const account = snapshotFromAccount(got.json)
      if (account) return { ok: true, account, replaced: false }
    }
    await deleteExpressConnectAccount(existing)
  }
  const created = await createExpressConnectAccount(params)
  if (!created.ok) return created
  return { ok: true, account: created.account, replaced: existing.startsWith("acct_") }
}

export async function retrieveConnectAccount(
  accountId: string,
): Promise<
  | { ok: true; account: StripeConnectAccountSnapshot }
  | { ok: false; error: string }
> {
  const id = accountId.trim()
  if (!id.startsWith("acct_")) {
    return { ok: false, error: "Invalid Connect account id" }
  }
  const got = await stripeGet(`accounts/${encodeURIComponent(id)}`)
  if (!got.ok) return { ok: false, error: stripeErrorMessage(got.json) }
  const account = snapshotFromAccount(got.json)
  if (!account) return { ok: false, error: "Stripe account response missing id" }
  return { ok: true, account }
}

/** Best-effort delete of an Express connected account (onboarding reset). */
export async function deleteExpressConnectAccount(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = accountId.trim()
  if (!id.startsWith("acct_")) return { ok: true }
  const deleted = await stripeDelete(`accounts/${encodeURIComponent(id)}`)
  if (deleted.ok || deleted.status === 404) return { ok: true }
  return { ok: false, error: stripeErrorMessage(deleted.json) }
}

function titleCase(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function parseExternalAccount(
  row: Record<string, unknown>,
): StripeConnectPayoutMethod | null {
  const id = typeof row.id === "string" ? row.id.trim() : ""
  if (!id) return null
  const object = typeof row.object === "string" ? row.object.trim() : ""
  const last4 =
    typeof row.last4 === "string" && /^\d{2,4}$/.test(row.last4.trim())
      ? row.last4.trim()
      : null
  const currency =
    typeof row.currency === "string" && row.currency.trim()
      ? row.currency.trim().toUpperCase()
      : null
  const defaultForCurrency = row.default_for_currency === true

  if (object === "bank_account") {
    const bankName =
      typeof row.bank_name === "string" && row.bank_name.trim()
        ? row.bank_name.trim()
        : null
    const holder =
      typeof row.account_holder_name === "string" && row.account_holder_name.trim()
        ? row.account_holder_name.trim()
        : null
    const labelParts = [
      bankName ?? "Bank account",
      last4 ? `•••• ${last4}` : null,
      holder ? `(${holder})` : null,
    ].filter(Boolean)
    return {
      id,
      kind: "bank_account",
      label: labelParts.join(" "),
      last4,
      bankName,
      brand: null,
      funding: null,
      defaultForCurrency,
      currency,
    }
  }

  if (object === "card") {
    const brandRaw = typeof row.brand === "string" ? row.brand.trim() : ""
    const brand = brandRaw ? titleCase(brandRaw) : "Card"
    const fundingRaw = typeof row.funding === "string" ? row.funding.trim() : ""
    const funding = fundingRaw ? titleCase(fundingRaw) : null
    const expMonth =
      typeof row.exp_month === "number" && Number.isFinite(row.exp_month)
        ? row.exp_month
        : null
    const expYear =
      typeof row.exp_year === "number" && Number.isFinite(row.exp_year)
        ? row.exp_year
        : null
    const exp =
      expMonth != null && expYear != null
        ? ` · exp ${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`
        : ""
    const fundingNote = funding ? ` ${funding.toLowerCase()}` : ""
    return {
      id,
      kind: "card",
      label: `${brand}${fundingNote} ···· ${last4 ?? "••••"}${exp}`,
      last4,
      bankName: null,
      brand,
      funding,
      defaultForCurrency,
      currency,
    }
  }

  return null
}

/**
 * List masked bank accounts / debit cards on a Connect account for payout confirmation.
 * Never returns full account or routing numbers.
 */
export async function listConnectPayoutMethods(
  accountId: string,
): Promise<
  | { ok: true; methods: StripeConnectPayoutMethod[] }
  | { ok: false; error: string }
> {
  const id = accountId.trim()
  if (!id.startsWith("acct_")) {
    return { ok: false, error: "Invalid Connect account id" }
  }
  const got = await stripeGet(
    `accounts/${encodeURIComponent(id)}/external_accounts?limit=10`,
  )
  if (!got.ok) return { ok: false, error: stripeErrorMessage(got.json) }
  const data = Array.isArray(got.json.data) ? got.json.data : []
  const methods: StripeConnectPayoutMethod[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue
    const parsed = parseExternalAccount(raw as Record<string, unknown>)
    if (parsed) methods.push(parsed)
  }
  methods.sort((a, b) => Number(b.defaultForCurrency) - Number(a.defaultForCurrency))
  return { ok: true, methods }
}

/** Form body for Stripe Account Sessions (embedded Connect onboarding). */
export function connectAccountSessionParams(accountId: string): URLSearchParams {
  const body = new URLSearchParams()
  body.set("account", accountId)
  body.set("components[account_onboarding][enabled]", "true")
  body.set(
    "components[account_onboarding][features][external_account_collection]",
    "true",
  )
  body.set(
    "components[account_onboarding][features][disable_stripe_user_authentication]",
    "true",
  )
  return body
}

/**
 * Create an Account Session for the embedded account_onboarding component.
 * The connected account is resolved server-side — do not take account ids from the client.
 */
export async function createConnectAccountSession(params: {
  accountId: string
}): Promise<{ ok: true; clientSecret: string } | { ok: false; error: string }> {
  const accountId = params.accountId.trim()
  if (!accountId.startsWith("acct_")) {
    return { ok: false, error: "Invalid Connect account id" }
  }
  const created = await stripeForm("account_sessions", connectAccountSessionParams(accountId))
  if (!created.ok) {
    return { ok: false, error: stripeErrorMessage(created.json) }
  }
  const clientSecret =
    typeof created.json.client_secret === "string"
      ? created.json.client_secret.trim()
      : ""
  if (!clientSecret) {
    return { ok: false, error: "Stripe did not return an Account Session secret" }
  }
  return { ok: true, clientSecret }
}

export async function createConnectAccountLink(params: {
  accountId: string
  refreshUrl: string
  returnUrl: string
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const body = new URLSearchParams()
  body.set("account", params.accountId)
  body.set("refresh_url", params.refreshUrl)
  body.set("return_url", params.returnUrl)
  body.set("type", "account_onboarding")

  const created = await stripeForm("account_links", body)
  if (!created.ok) {
    return { ok: false, error: stripeErrorMessage(created.json) }
  }
  const url = typeof created.json.url === "string" ? created.json.url.trim() : ""
  if (!url) return { ok: false, error: "Stripe did not return an Account Link URL" }
  return { ok: true, url }
}

export function isStripeConfigured(): boolean {
  return Boolean(stripeSecret())
}

/**
 * Official readiness check for any Stripe Connect account.
 * Ready = valid `acct_…` id AND charges enabled.
 * Rent and invoice flows both call this; they only differ in who the destination is.
 */
export function isStripeConnectReady(
  destination: {
    accountId?: string | null
    chargesEnabled?: boolean | null
  } | null | undefined,
): boolean {
  if (!destination) return false
  const accountId =
    typeof destination.accountId === "string" ? destination.accountId.trim() : ""
  return accountId.startsWith("acct_") && destination.chargesEnabled === true
}

/** Map a landlords/vendors row into a Connect destination (or null if no account). */
export function stripeConnectDestinationFromRow(
  row: {
    stripe_connect_account_id?: string | null
    stripe_connect_charges_enabled?: boolean | null
    stripe_connect_payouts_enabled?: boolean | null
    stripe_connect_details_submitted?: boolean | null
  } | null | undefined,
): StripeConnectDestination | null {
  const accountId =
    typeof row?.stripe_connect_account_id === "string"
      ? row.stripe_connect_account_id.trim()
      : ""
  if (!accountId.startsWith("acct_")) return null
  return {
    accountId,
    chargesEnabled: row?.stripe_connect_charges_enabled === true,
    payoutsEnabled: row?.stripe_connect_payouts_enabled === true,
    detailsSubmitted: row?.stripe_connect_details_submitted === true,
  }
}

/** Load landlord Connect destination (rent payouts). */
export async function loadLandlordStripeDestination(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<StripeConnectDestination | null> {
  const id = landlordId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("landlords")
    .select(
      "stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted",
    )
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  return stripeConnectDestinationFromRow(data)
}

/** Load vendor Connect destination (invoice payouts). */
export async function loadVendorStripeDestination(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<StripeConnectDestination | null> {
  const id = vendorId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("vendors")
    .select(
      "stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted",
    )
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  return stripeConnectDestinationFromRow(data)
}

export async function isLandlordStripeConnectReady(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  return isStripeConnectReady(
    await loadLandlordStripeDestination(supabase, landlordId),
  )
}

export async function isVendorStripeConnectReady(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<boolean> {
  return isStripeConnectReady(
    await loadVendorStripeDestination(supabase, vendorId),
  )
}
