/**
 * Landlord Stripe Express Connect for rent payouts (onboarding).
 *
 * Actions:
 * - create_account_session (embedded Connect onboarding)
 * - create_connect_account_link (hosted fallback)
 * - refresh_connect_status
 * - status (read flags only)
 * - clear_connect (onboarding reset — unlink + delete Express account)
 *
 * Auth: ADMIN_REASSIGN_SECRET (same as other admin edges).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import { recordLandlordStripeConnectReadyIfTransition } from "../_shared/paymentActivityEvents.ts"
import {
  createConnectAccountLink,
  createConnectAccountSession,
  deleteExpressConnectAccount,
  ensureEmbeddedConnectAccount,
  isStripeConfigured,
  isStripeConnectReady,
  listConnectPayoutMethods,
  assertConnectReturnOriginForStripe,
  resolveConnectAppBaseUrl,
  retrieveConnectAccount,
  type StripeConnectPayoutMethod,
} from "../_shared/stripeConnect.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { landlordHasPayments } from "../../../shared/landlordCapabilities.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function payoutSnapshot(row: {
  stripe_connect_account_id?: string | null
  stripe_connect_charges_enabled?: boolean | null
  stripe_connect_payouts_enabled?: boolean | null
  stripe_connect_details_submitted?: boolean | null
}, payoutMethods: StripeConnectPayoutMethod[] = []) {
  const accountId =
    typeof row.stripe_connect_account_id === "string"
      ? row.stripe_connect_account_id.trim()
      : ""
  const chargesEnabled = row.stripe_connect_charges_enabled === true
  return {
    accountId: accountId || null,
    chargesEnabled,
    payoutsEnabled: row.stripe_connect_payouts_enabled === true,
    detailsSubmitted: row.stripe_connect_details_submitted === true,
    ready: isStripeConnectReady({ accountId, chargesEnabled }),
    payoutMethods,
  }
}

async function loadPayoutMethods(
  accountId: string | null | undefined,
): Promise<StripeConnectPayoutMethod[]> {
  const id = typeof accountId === "string" ? accountId.trim() : ""
  if (!id.startsWith("acct_") || !isStripeConfigured()) return []
  const listed = await listConnectPayoutMethods(id)
  if (!listed.ok) {
    console.warn("[landlord-stripe-connect] payout methods", listed.error)
    return []
  }
  return listed.methods
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const adminAuth = requireAdminReassignAuth(req, "[landlord-stripe-connect]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response


  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim() : ""
  const landlordId =
    typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!action) return jsonResponse({ error: "Missing action" }, 400)
  if (!landlordId || !isUuidShape(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  if (!landlordHasPayments(landlordId)) {
    return jsonResponse({ error: "Payments are not available on this account." }, 403)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: landlord, error: loadErr } = await supabase
    .from("landlords")
    .select(
      "id, name, email, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted",
    )
    .eq("id", landlordId)
    .maybeSingle()

  if (loadErr) {
    console.error("[landlord-stripe-connect] load", loadErr)
    return jsonResponse({ error: "Could not load landlord" }, 500)
  }
  if (!landlord) {
    return jsonResponse({ error: "Landlord not found" }, 404)
  }

  if (action === "status") {
    const methods = await loadPayoutMethods(landlord.stripe_connect_account_id)
    return jsonResponse({ ok: true, ...payoutSnapshot(landlord, methods) })
  }

  if (action === "clear_connect") {
    const accountId =
      typeof landlord.stripe_connect_account_id === "string"
        ? landlord.stripe_connect_account_id.trim()
        : ""
    if (accountId && isStripeConfigured()) {
      const deleted = await deleteExpressConnectAccount(accountId)
      if (!deleted.ok) {
        console.warn("[landlord-stripe-connect] delete account", deleted.error)
      }
    }
    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("landlords")
      .update({
        stripe_connect_account_id: null,
        stripe_connect_charges_enabled: false,
        stripe_connect_payouts_enabled: false,
        stripe_connect_details_submitted: false,
        stripe_connect_updated_at: nowIso,
      })
      .eq("id", landlordId)
    if (updErr) {
      console.error("[landlord-stripe-connect] clear_connect", updErr)
      return jsonResponse({ error: "Could not clear payout account" }, 500)
    }
    if (accountId) {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "landlord.stripe_connect_cleared",
        source: "dashboard",
        actorType: "landlord",
        metadata: {
          message: "Rent payout account was removed so onboarding can start over.",
        },
      })
    }
    return jsonResponse({
      ok: true,
      ...payoutSnapshot({
        stripe_connect_account_id: null,
        stripe_connect_charges_enabled: false,
        stripe_connect_payouts_enabled: false,
        stripe_connect_details_submitted: false,
      }),
    })
  }

  if (!isStripeConfigured()) {
    return jsonResponse(
      {
        error:
          "Payout setup is temporarily unavailable. Set STRIPE_SECRET_KEY and try again.",
      },
      503,
    )
  }

  if (action === "create_account_session" || action === "create_connect_account_link") {
    if (action === "create_connect_account_link") {
      const base = resolveConnectAppBaseUrl({
        returnOrigin:
          typeof body.returnOrigin === "string" ? body.returnOrigin : undefined,
        requestOrigin: req.headers.get("origin"),
      })
      const originCheck = assertConnectReturnOriginForStripe(base)
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, 400)
      }
    }

    let accountId =
      typeof landlord.stripe_connect_account_id === "string"
        ? landlord.stripe_connect_account_id.trim()
        : ""

    const ensured = await ensureEmbeddedConnectAccount({
      existingAccountId: accountId || null,
      landlordId,
      email: landlord.email,
      businessName: landlord.name,
    })
    if (!ensured.ok) {
      return jsonResponse({ error: ensured.error }, 502)
    }
    const createdNew = !accountId || ensured.replaced || ensured.account.id !== accountId
    accountId = ensured.account.id
    if (createdNew) {
      const nowIso = new Date().toISOString()
      const { error: updErr } = await supabase
        .from("landlords")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_charges_enabled: ensured.account.chargesEnabled,
          stripe_connect_payouts_enabled: ensured.account.payoutsEnabled,
          stripe_connect_details_submitted: ensured.account.detailsSubmitted,
          stripe_connect_updated_at: nowIso,
        })
        .eq("id", landlordId)
      if (updErr) {
        console.error("[landlord-stripe-connect] persist account", updErr)
        return jsonResponse({ error: "Could not save payout account" }, 500)
      }
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "landlord.stripe_connect_started",
        source: "dashboard",
        actorType: "landlord",
        metadata: {
          message: "Landlord started rent payout account setup.",
          stripe_connect_account_id: accountId,
        },
      })
    }

    const { data: fresh } = await supabase
      .from("landlords")
      .select(
        "stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted",
      )
      .eq("id", landlordId)
      .maybeSingle()

    const methods = await loadPayoutMethods(
      fresh?.stripe_connect_account_id ?? accountId,
    )
    const snapshot = payoutSnapshot(fresh ?? landlord, methods)

    if (action === "create_account_session") {
      const sessionCreated = await createConnectAccountSession({ accountId })
      if (!sessionCreated.ok) {
        return jsonResponse({ error: sessionCreated.error }, 502)
      }
      return jsonResponse({
        ok: true,
        clientSecret: sessionCreated.clientSecret,
        ...snapshot,
      })
    }

    const base = resolveConnectAppBaseUrl({
      returnOrigin:
        typeof body.returnOrigin === "string" ? body.returnOrigin : undefined,
      requestOrigin: req.headers.get("origin"),
    })
    const returnUrl = `${base}/admin/onboarding?connect=return`
    const refreshUrl = `${base}/admin/onboarding?connect=refresh`
    const link = await createConnectAccountLink({
      accountId,
      refreshUrl,
      returnUrl,
    })
    if (!link.ok) {
      return jsonResponse({ error: link.error }, 502)
    }
    return jsonResponse({
      ok: true,
      url: link.url,
      ...snapshot,
    })
  }

  if (action === "refresh_connect_status") {
    const accountId =
      typeof landlord.stripe_connect_account_id === "string"
        ? landlord.stripe_connect_account_id.trim()
        : ""
    if (!accountId) {
      return jsonResponse({
        ok: true,
        ...payoutSnapshot({
          stripe_connect_account_id: null,
          stripe_connect_charges_enabled: false,
          stripe_connect_payouts_enabled: false,
          stripe_connect_details_submitted: false,
        }),
      })
    }

    const retrieved = await retrieveConnectAccount(accountId)
    if (!retrieved.ok) {
      return jsonResponse({ error: retrieved.error }, 502)
    }

    const wasReady = isStripeConnectReady({
      accountId: landlord.stripe_connect_account_id,
      chargesEnabled: landlord.stripe_connect_charges_enabled,
    })
    const nowReady = isStripeConnectReady({
      accountId: retrieved.account.id,
      chargesEnabled: retrieved.account.chargesEnabled,
    })
    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("landlords")
      .update({
        stripe_connect_account_id: retrieved.account.id,
        stripe_connect_charges_enabled: retrieved.account.chargesEnabled,
        stripe_connect_payouts_enabled: retrieved.account.payoutsEnabled,
        stripe_connect_details_submitted: retrieved.account.detailsSubmitted,
        stripe_connect_updated_at: nowIso,
      })
      .eq("id", landlordId)
    if (updErr) {
      console.error("[landlord-stripe-connect] refresh persist", updErr)
      return jsonResponse({ error: "Could not update payout status" }, 500)
    }

    if (nowReady && !wasReady) {
      await recordLandlordStripeConnectReadyIfTransition(supabase, {
        landlordId,
        wasReady,
        nowReady,
      })
    }

    const methods = await loadPayoutMethods(retrieved.account.id)
    return jsonResponse({
      ok: true,
      ...payoutSnapshot({
        stripe_connect_account_id: retrieved.account.id,
        stripe_connect_charges_enabled: retrieved.account.chargesEnabled,
        stripe_connect_payouts_enabled: retrieved.account.payoutsEnabled,
        stripe_connect_details_submitted: retrieved.account.detailsSubmitted,
      }, methods),
    })
  }

  return jsonResponse({ error: `Unknown action: ${action}` }, 400)
})
