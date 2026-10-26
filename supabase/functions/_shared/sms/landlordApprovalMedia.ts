/**
 * Turn stored resident photos and videos into links the text carrier can fetch.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isHttpUrl,
  isProviderAuthMediaUrl,
  isStorageMediaPath,
} from "../../../../shared/sms/media.ts"
import { residentMediaRefs } from "../../../../shared/sms/landlordApprovalMedia.ts"

export {
  landlordApprovalMediaFallbackLine,
  landlordApprovalMediaLine,
  residentMediaRefs,
} from "../../../../shared/sms/landlordApprovalMedia.ts"

const SIGNED_URL_TTL_SEC = 60 * 60
const BUCKET = "maintenance-uploads"

export type ResidentApprovalMedia = {
  /** Every resident photo or video on the request. */
  storedRefs: string[]
  /** Paths that have a carrier link, saved on the outbound message. */
  refs: string[]
  /** HTTPS URLs passed to the carrier for this send. */
  urls: string[]
}

export async function loadTicketResidentMedia(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<ResidentApprovalMedia> {
  const id = ticketId.trim()
  if (!id) return { storedRefs: [], refs: [], urls: [] }
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("photo_paths")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return { storedRefs: [], refs: [], urls: [] }
  const storedRefs = residentMediaRefs(data.photo_paths)
  const signed = await signResidentMedia(supabase, storedRefs)
  return { storedRefs, refs: signed.refs, urls: signed.urls }
}

async function signResidentMedia(
  supabase: SupabaseClient,
  refs: string[],
): Promise<{ refs: string[]; urls: string[] }> {
  const readyRefs: string[] = []
  const urls: string[] = []
  for (const ref of refs) {
    const url = await publicMediaUrl(supabase, ref)
    if (!url) continue
    readyRefs.push(ref)
    urls.push(url)
  }
  return { refs: readyRefs, urls }
}

async function publicMediaUrl(
  supabase: SupabaseClient,
  ref: string,
): Promise<string | null> {
  if (isStorageMediaPath(ref)) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ref, SIGNED_URL_TTL_SEC)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  }
  if (isHttpUrl(ref) && !isProviderAuthMediaUrl(ref)) return ref
  return null
}
