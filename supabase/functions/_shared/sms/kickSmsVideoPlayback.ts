import { needsBrowserVideoConversion } from "./media.ts"
import { isStorageMediaPath } from "./media.ts"

const DEFAULT_CONVERT_URL = "https://www.ulohome.io/api/convert-sms-media"

/**
 * Ask the site converter to make a browser-playable sibling.
 * Best-effort: a failure leaves the original saved and the preview retryable.
 * Does not text anyone.
 */
export async function kickSmsVideoPlayback(paths: string[]): Promise<void> {
  const targets = paths.filter((path) =>
    isStorageMediaPath(path) && needsBrowserVideoConversion(path)
  )
  if (targets.length === 0) return
  const secret = Deno.env.get("CONVERT_MEDIA_SECRET")?.trim()
  const url = Deno.env.get("CONVERT_MEDIA_URL")?.trim() || DEFAULT_CONVERT_URL
  if (!secret) {
    console.warn("[sms-inbound] CONVERT_MEDIA_SECRET unset; playback waits for a staff retry")
    return
  }
  await Promise.all(targets.map(async (path) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ulo-convert-secret": secret,
        },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) {
        console.error("[sms-inbound] playback convert", res.status)
      }
    } catch (error) {
      console.error("[sms-inbound] playback convert failed", error)
    }
  }))
}
