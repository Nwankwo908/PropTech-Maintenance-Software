/**
 * Per-landlord Thumbtack authorization_code refresh tokens.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  isLimitedAlphaLandlord,
  isRetiredLandlordAccountId,
} from "../../../../shared/landlordCapabilities.ts"

function remapThumbtackOauthLandlordId(landlordId: string): string {
  const id = landlordId.trim()
  return isRetiredLandlordAccountId(id) ? LIMITED_ALPHA_1_LANDLORD_ID : id
}

export function thumbtackOauthLandlordCandidates(...landlordIds: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const add = (raw: string | null | undefined) => {
    const id = (raw ?? "").trim()
    if (!id) return
    const remapped = remapThumbtackOauthLandlordId(id)
    for (const next of [remapped, id]) {
      if (!out.includes(next)) out.push(next)
    }
  }
  for (const id of landlordIds) add(id)
  const looksAlpha = landlordIds.some((id) => {
    const t = (id ?? "").trim()
    return isLimitedAlphaLandlord(t) || isRetiredLandlordAccountId(t)
  })
  if (looksAlpha) {
    add(LIMITED_ALPHA_1_LANDLORD_ID)
    add(LIMITED_ALPHA_2_LANDLORD_ID)
  }
  return out
}

export async function loadLandlordThumbtackRefreshToken(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const loaded = await loadLandlordThumbtackOAuth(supabase, landlordId)
  return loaded?.refreshToken ?? null
}

export async function loadLandlordThumbtackOAuth(
  supabase: SupabaseClient,
  landlordId: string,
  extraLandlordIds?: Array<string | null | undefined>,
): Promise<{
  landlordId: string
  refreshToken: string
  accessToken: string | null
  accessExpiresAt: string | null
} | null> {
  for (const id of thumbtackOauthLandlordCandidates(landlordId, ...(extraLandlordIds ?? []))) {
    const loaded = await loadLandlordThumbtackOAuthRow(supabase, id)
    if (loaded) return { landlordId: id, ...loaded }
  }
  return null
}

async function loadLandlordThumbtackOAuthRow(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  refreshToken: string
  accessToken: string | null
  accessExpiresAt: string | null
} | null> {
  const { data, error } = await supabase
    .from("landlord_thumbtack_oauth")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("landlord_id", id)
    .maybeSingle()
  if (error) {
    if (/access_token/i.test(error.message)) {
      const fallback = await supabase
        .from("landlord_thumbtack_oauth")
        .select("refresh_token")
        .eq("landlord_id", id)
        .maybeSingle()
      const token = typeof fallback.data?.refresh_token === "string"
        ? fallback.data.refresh_token.trim()
        : ""
      return token ? { refreshToken: token, accessToken: null, accessExpiresAt: null } : null
    }
    console.warn("[thumbtack-oauth] load refresh", error.message)
    return null
  }
  const token = typeof data?.refresh_token === "string" ? data.refresh_token.trim() : ""
  if (!token) return null
  return {
    refreshToken: token,
    accessToken: typeof data?.access_token === "string" ? data.access_token.trim() : null,
    accessExpiresAt: typeof data?.access_token_expires_at === "string"
      ? data.access_token_expires_at
      : null,
  }
}

export async function saveLandlordThumbtackRefreshToken(
  supabase: SupabaseClient,
  landlordId: string,
  refreshToken: string,
  opts?: {
    scope?: string | null
    accessToken?: string | null
    expiresInSec?: number | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const id = remapThumbtackOauthLandlordId(landlordId.trim())
  const token = refreshToken.trim()
  if (!id || !token) return { ok: false, error: "missing_token" }
  const now = new Date().toISOString()
  const access = opts?.accessToken?.trim() || null
  const expiresIn = typeof opts?.expiresInSec === "number" && opts.expiresInSec > 60
    ? opts.expiresInSec
    : null
  const row: Record<string, unknown> = {
    landlord_id: id,
    refresh_token: token,
    scope: opts?.scope?.trim() || null,
    updated_at: now,
  }
  if (access) {
    row.access_token = access
    row.access_token_expires_at = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null
  }
  const { error } = await supabase.from("landlord_thumbtack_oauth").upsert(row, {
    onConflict: "landlord_id",
  })
  if (error && /access_token/i.test(error.message) && access) {
    delete row.access_token
    delete row.access_token_expires_at
    const retry = await supabase.from("landlord_thumbtack_oauth").upsert(row, {
      onConflict: "landlord_id",
    })
    if (retry.error) {
      console.error("[thumbtack-oauth] save refresh", retry.error.message)
      return { ok: false, error: retry.error.message }
    }
    console.warn("[thumbtack-oauth] saved refresh without access_token column")
    return { ok: true }
  }
  if (error) {
    console.error("[thumbtack-oauth] save refresh", error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function landlordThumbtackIsConnected(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  return Boolean(await loadLandlordThumbtackRefreshToken(supabase, landlordId))
}
