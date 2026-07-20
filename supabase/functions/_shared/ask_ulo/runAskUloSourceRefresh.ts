/**
 * Claim due Ask Ulo official source feeds and probe them on cadence.
 * Full re-ingest of changed law text is a follow-on; this job keeps freshness metadata current.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  nextCheckAtAfter,
  probeOfficialSource,
  type RefreshCadence,
  type SourceFeedRow,
} from "./refreshCadence.ts"

export type RefreshAskUloSourcesResult = {
  examined: number
  checked: number
  changed: number
  unchanged: number
  errors: number
  skipped: number
  feeds: Array<{
    feedKey: string
    status: string
    nextCheckAt: string
    error?: string
  }>
}

export async function refreshAskUloSources(
  supabase: SupabaseClient,
  opts?: { limit?: number; fetchImpl?: typeof fetch; now?: Date },
): Promise<RefreshAskUloSourcesResult> {
  const limit = opts?.limit ?? 25
  const now = opts?.now ?? new Date()
  const fetchImpl = opts?.fetchImpl ?? fetch

  const { data, error } = await supabase.rpc("list_ask_ulo_source_feeds_due", {
    limit_count: limit,
  })
  if (error) {
    throw new Error(`list_ask_ulo_source_feeds_due: ${error.message}`)
  }

  const feeds = (Array.isArray(data) ? data : []) as SourceFeedRow[]
  const result: RefreshAskUloSourcesResult = {
    examined: feeds.length,
    checked: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    skipped: 0,
    feeds: [],
  }

  for (const feed of feeds) {
    const probe = await probeOfficialSource(feed, fetchImpl)
    result.checked += 1
    if (probe.status === "changed") result.changed += 1
    else if (probe.status === "unchanged" || probe.status === "ok") result.unchanged += 1
    else if (probe.status === "error") result.errors += 1
    else if (probe.status === "skipped") result.skipped += 1

    const cadence = feed.refresh_cadence as RefreshCadence
    const next = nextCheckAtAfter(cadence, now)
    const nextIso = next.toISOString()

    const patch: Record<string, unknown> = {
      last_checked_at: now.toISOString(),
      next_check_at: nextIso,
      last_check_status: probe.status,
      last_check_error: probe.error ?? null,
      updated_at: now.toISOString(),
    }
    if (probe.etag != null) patch.last_etag = probe.etag
    if (probe.lastModified != null) patch.last_modified_header = probe.lastModified
    if (probe.fingerprint != null) patch.content_fingerprint = probe.fingerprint
    if (probe.changed) patch.last_change_detected_at = now.toISOString()

    const { error: updErr } = await supabase
      .from("ask_ulo_source_feeds")
      .update(patch)
      .eq("id", feed.id)
    if (updErr) {
      result.errors += 1
      result.feeds.push({
        feedKey: feed.feed_key,
        status: "error",
        nextCheckAt: nextIso,
        error: updErr.message,
      })
      continue
    }

    // Keep linked chunks' check stamps aligned with the feed.
    await supabase
      .from("legal_rag_chunks")
      .update({
        source_checked_at: now.toISOString(),
        next_check_at: nextIso,
      })
      .eq("source_feed_id", feed.id)

    result.feeds.push({
      feedKey: feed.feed_key,
      status: probe.status,
      nextCheckAt: nextIso,
      error: probe.error ?? undefined,
    })
  }

  // Drop expired retrieval cache rows while we're already on a maintenance path.
  try {
    await supabase.rpc("purge_ask_ulo_retrieval_cache_expired")
  } catch {
    // Migration may not be applied yet.
  }

  return result
}
