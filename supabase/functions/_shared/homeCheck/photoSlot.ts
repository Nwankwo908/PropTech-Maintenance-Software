import { getVisionProvider } from '../vision/getProvider.ts'
import { inspectionBytesToBase64 } from '../vision/ingestInspectionUpload.ts'
import type { ApplianceVisionResult } from '../vision/types.ts'

/**
 * Reads what an unnumbered Home Check photo shows so it can be filed in the right
 * slot. Returns null when the reader is unavailable; the sender is then asked.
 */
export async function readHomeCheckPhoto(
  bytes: Uint8Array,
  contentType: string,
): Promise<ApplianceVisionResult | null> {
  try {
    return await getVisionProvider().analyzeImage(
      inspectionBytesToBase64(bytes),
      undefined,
      contentType,
    )
  } catch {
    return null
  }
}
