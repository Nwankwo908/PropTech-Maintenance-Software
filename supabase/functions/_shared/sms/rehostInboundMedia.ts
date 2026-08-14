import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isStorageMediaPath,
  mediaKindFromContentType,
  mediaKindFromRef,
} from "./media.ts"

function extFromContentType(contentType: string, fallbackRef: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes("png")) return "png"
  if (ct.includes("gif")) return "gif"
  if (ct.includes("webp")) return "webp"
  if (ct.includes("heic")) return "heic"
  if (ct.includes("heif")) return "heif"
  if (ct.includes("mp4")) return "mp4"
  if (ct.includes("quicktime") || ct.includes("mov")) return "mov"
  if (ct.includes("webm")) return "webm"
  if (ct.includes("3gpp") || ct.includes("3gp")) return "3gp"
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg"

  const fromRef = fallbackRef.toLowerCase()
  const match = fromRef.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)
  if (match?.[1]) return match[1].toLowerCase()
  return mediaKindFromRef(fallbackRef) === "video" ? "mp4" : "jpg"
}

function isAcceptedMediaContentType(contentType: string, fallbackRef: string): boolean {
  const kind = mediaKindFromContentType(contentType)
  if (kind) return true
  const ct = contentType.toLowerCase()
  if (ct.startsWith("application/octet-stream") || !ct) {
    return Boolean(fallbackRef)
  }
  return false
}

async function fetchProviderMedia(
  url: string,
  provider: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {}
  const isTwilio = provider === "twilio" || url.includes("api.twilio.com")
  if (isTwilio) {
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim()
    if (twilioSid && twilioToken) {
      headers.Authorization = `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`
    }
  }
  return await fetch(url, { headers })
}

/**
 * Download inbound MMS (photos + videos) and rehost into the private
 * `maintenance-uploads` bucket so the dashboard can render signed URLs.
 * Already-stored object paths are kept as-is. Best-effort: a failing item
 * keeps its original URL so a later submit can retry.
 */
export async function rehostInboundSmsMedia(
  supabase: SupabaseClient,
  params: {
    mediaUrls: string[] | undefined
    provider?: string
    storagePrefix: string
  },
): Promise<string[]> {
  const mediaUrls = Array.isArray(params.mediaUrls) ? params.mediaUrls : []
  if (mediaUrls.length === 0) return []

  const prefix = params.storagePrefix.replace(/\/+$/, "")
  const out: string[] = []
  let idx = 0

  for (const rawUrl of mediaUrls) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) continue
    const url = rawUrl.trim()
    if (isStorageMediaPath(url)) {
      out.push(url)
      continue
    }

    try {
      const res = await fetchProviderMedia(url, params.provider)
      if (!res.ok) {
        console.error("[sms-media] fetch failed", url, res.status)
        out.push(url)
        continue
      }

      const contentType = res.headers.get("content-type") || ""
      if (!isAcceptedMediaContentType(contentType, url)) {
        console.warn("[sms-media] skipping unsupported media", url, contentType)
        out.push(url)
        continue
      }

      const bytes = new Uint8Array(await res.arrayBuffer())
      const ext = extFromContentType(contentType, url)
      const path = `${prefix}/${Date.now()}-${idx}.${ext}`
      const uploadType =
        contentType.split(";")[0]?.trim() ||
        (ext === "mp4" || ext === "mov" || ext === "webm" || ext === "3gp"
          ? `video/${ext === "mov" ? "quicktime" : ext}`
          : `image/${ext === "jpg" ? "jpeg" : ext}`)

      const { error } = await supabase.storage
        .from("maintenance-uploads")
        .upload(path, bytes, { contentType: uploadType, upsert: false })

      if (error) {
        console.error("[sms-media] upload failed", path, error.message)
        out.push(url)
        continue
      }

      out.push(path)
      idx += 1
    } catch (e) {
      console.error("[sms-media] rehost error", url, e)
      out.push(url)
    }
  }

  return out
}

export function inboundMediaWasRehosted(
  original: string[] | undefined,
  rehosted: string[],
): boolean {
  if (rehosted.length === 0) return false
  const src = Array.isArray(original) ? original : []
  if (src.length !== rehosted.length) return true
  return rehosted.some((value, i) => value !== src[i] && isStorageMediaPath(value))
}
