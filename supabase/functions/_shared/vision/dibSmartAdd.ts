/**
 * Dib Smart Add — identification pass for inspection photos (Option B hybrid).
 *
 * Env (Edge secrets):
 *   DIB_API_KEY                         — dib_live_* / dib_test_*
 *   DIB_API_VERSION                     — default 2026-05-24
 *   DIB_SMART_ADD_CONFIDENCE_THRESHOLD  — 0–100, default 75
 *   DIB_SMART_ADD_ENABLED               — set "false" to disable without removing key
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  parseDibSmartAddResponse,
  type DibIdentification,
} from "../../../../shared/vision/dibHybrid.ts"

const DIB_API_BASE = "https://dib.io/api"
const DEFAULT_API_VERSION = "2026-05-24"
const SIGNED_URL_TTL_SEC = 3600

export type DibSmartAddResult = {
  identification: DibIdentification
  latencyMs: number
  confidenceThreshold: number
  rawCandidateCount: number
}

function asBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue
  const v = raw.trim().toLowerCase()
  if (v === "false" || v === "0" || v === "off" || v === "no") return false
  return true
}

function confidenceThresholdPercent(): number {
  const raw = Deno.env.get("DIB_SMART_ADD_CONFIDENCE_THRESHOLD")?.trim()
  if (!raw) return 75
  const n = Number(raw)
  if (!Number.isFinite(n)) return 75
  return Math.min(100, Math.max(0, n))
}

export function isDibSmartAddEnabled(): boolean {
  if (!asBooleanEnv(Deno.env.get("DIB_SMART_ADD_ENABLED"), true)) return false
  const key = Deno.env.get("DIB_API_KEY")?.trim()
  return Boolean(key)
}

export async function createInspectionUploadSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const path = storagePath.trim()
  if (!path) return null

  const { data, error } = await supabase.storage
    .from("inspection-uploads")
    .createSignedUrl(path, SIGNED_URL_TTL_SEC)

  if (error || !data?.signedUrl) {
    console.warn("[dib-smart-add] signed URL failed:", error?.message ?? "missing signedUrl")
    return null
  }
  return data.signedUrl
}

function countCandidates(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0
  const root = payload as Record<string, unknown>
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root
  let count = 0
  for (const key of ["candidates", "items", "saved", "saved_items", "results", "detected_items"]) {
    const value = data[key]
    if (Array.isArray(value)) count += value.length
  }
  return count
}

/** Best-effort Dib identification. Returns null when disabled, misconfigured, or no match. */
export async function identifyWithDibSmartAdd(
  imageUrl: string,
): Promise<DibSmartAddResult | null> {
  const apiKey = Deno.env.get("DIB_API_KEY")?.trim()
  if (!apiKey || !isDibSmartAddEnabled()) return null

  const url = imageUrl.trim()
  if (!url) return null

  const apiVersion = Deno.env.get("DIB_API_VERSION")?.trim() || DEFAULT_API_VERSION
  const threshold = confidenceThresholdPercent()
  const started = Date.now()

  try {
    const res = await fetch(`${DIB_API_BASE}/v1/inventory/smart-add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Dib-API-Version": apiVersion,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        image_url: url,
        save: false,
        confidence_threshold: threshold,
      }),
    })

    const text = await res.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      console.warn("[dib-smart-add] non-JSON response", res.status, text.slice(0, 200))
      return null
    }

    if (!res.ok) {
      let dibErrorType: string | null = null
      try {
        const errJson = JSON.parse(text) as {
          error?: { type?: string; message?: string; fix?: string }
        }
        dibErrorType = errJson.error?.type ?? null
        if (dibErrorType === "malformed_api_key") {
          console.warn(
            "[dib-smart-add] DIB_API_KEY must be dib_live_* or dib_test_* from dib.io/developers — JWT/session tokens are not accepted.",
          )
        } else if (errJson.error?.message) {
          console.warn("[dib-smart-add]", res.status, errJson.error.message)
        }
      } catch {
        console.warn("[dib-smart-add] HTTP", res.status, text.slice(0, 300))
      }
      return null
    }

    const identification = parseDibSmartAddResponse(payload, threshold)
    if (!identification) return null

    return {
      identification,
      latencyMs: Date.now() - started,
      confidenceThreshold: threshold,
      rawCandidateCount: countCandidates(payload),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn("[dib-smart-add] request failed:", message)
    return null
  }
}
