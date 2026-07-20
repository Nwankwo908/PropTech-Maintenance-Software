/**
 * Ask Ulo source refresh cadence.
 *
 * Check each official feed as often as that source actually changes:
 * - Federal / state law & court opinions → daily
 * - Published city/county codes → weekly
 * - Council/clerk announcements (pending ordinances) → daily
 * - HUD datasets → when HUD publishes (official schedule)
 * - Equipment manuals → when manufacturer releases a new version/bulletin
 *
 * Prefer official .gov / HUD APIs — never treat aggregators as the source of truth.
 */

export type RefreshCadence =
  | "daily"
  | "weekly"
  | "on_publisher_schedule"
  | "on_manufacturer_release"

export type SourceFeedKind =
  | "federal_law"
  | "state_law"
  | "municipal_code_published"
  | "municipal_pending_announcements"
  | "court_opinions"
  | "hud_dataset"
  | "equipment_manual"
  | "agency_guidance"

/** Default cadence by feed kind (product policy). */
export const FEED_KIND_CADENCE: Record<SourceFeedKind, RefreshCadence> = {
  federal_law: "daily",
  state_law: "daily",
  municipal_code_published: "weekly",
  municipal_pending_announcements: "daily",
  court_opinions: "daily",
  hud_dataset: "on_publisher_schedule",
  equipment_manual: "on_manufacturer_release",
  agency_guidance: "on_publisher_schedule",
}

/** Map passport document_type → default cadence when no feed is linked. */
export function cadenceForDocumentType(
  documentType: string | null | undefined,
): RefreshCadence {
  switch (documentType) {
    case "statute":
    case "regulation":
    case "court_opinion":
      return "daily"
    case "municipal_code":
    case "building_code":
      return "weekly"
    case "housing_program_rule":
    case "agency_guidance":
    case "government_guide":
      return "on_publisher_schedule"
    case "maintenance_manual":
      return "on_manufacturer_release"
    default:
      return "weekly"
  }
}

const MS_DAY = 24 * 60 * 60 * 1000
const MS_WEEK = 7 * MS_DAY

/**
 * Compute the next check time after a successful (or skipped) check.
 * HUD / manufacturer cadences stay on schedule until an external event bumps them.
 */
export function nextCheckAtAfter(
  cadence: RefreshCadence,
  from: Date = new Date(),
  opts?: {
    /** For on_publisher_schedule: explicit next release date from HUD calendar. */
    publisherNextReleaseAt?: Date | null
    /** If true, manufacturer feed was just notified of a new release. */
    manufacturerReleaseNow?: boolean
  },
): Date {
  switch (cadence) {
    case "daily":
      return new Date(from.getTime() + MS_DAY)
    case "weekly":
      return new Date(from.getTime() + MS_WEEK)
    case "on_publisher_schedule": {
      if (opts?.publisherNextReleaseAt && opts.publisherNextReleaseAt > from) {
        return opts.publisherNextReleaseAt
      }
      // Conservative poll while waiting for an official release window.
      return new Date(from.getTime() + MS_WEEK)
    }
    case "on_manufacturer_release": {
      if (opts?.manufacturerReleaseNow) {
        // Recheck soon after a release event, then idle until the next event.
        return new Date(from.getTime() + MS_DAY)
      }
      // Far-future sentinel — only claim when next_check_at is advanced by an event.
      return new Date(from.getTime() + 365 * MS_DAY)
    }
  }
}

export function isFeedDue(
  nextCheckAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (nextCheckAt == null) return true
  const t = typeof nextCheckAt === "string" ? new Date(nextCheckAt) : nextCheckAt
  if (Number.isNaN(t.getTime())) return true
  return t.getTime() <= now.getTime()
}

/** Reject known aggregator hosts for official refresh targets. */
const DISALLOWED_REFRESH_HOSTS = [
  "courtlistener.com",
  "justia.com",
  "findlaw.com",
  "municode.com",
  "library.municode.com",
  "nolo.com",
  "wikipedia.org",
]

export function isOfficialRefreshUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (DISALLOWED_REFRESH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return false
  }
  // Prefer government / legislature / court / HUD / manufacturer portals.
  return (
    host.endsWith(".gov") ||
    host.endsWith(".mil") ||
    host.includes("legislature") ||
    host.includes("huduser.gov") ||
    host.includes("hud.gov") ||
    host.includes("ecfr.gov") ||
    host.includes("congress.gov") ||
    host.includes("courts.") ||
    host.endsWith(".us")
  )
}

export type SourceFeedRow = {
  id: string
  feed_key: string
  label: string
  feed_kind: SourceFeedKind
  refresh_cadence: RefreshCadence
  official_url: string
  official_api_url: string | null
  next_check_at: string
  last_etag: string | null
  last_modified_header: string | null
  content_fingerprint: string | null
  publisher_schedule_note: string | null
}

export type FeedCheckResult = {
  status: "ok" | "changed" | "unchanged" | "error" | "skipped"
  etag?: string | null
  lastModified?: string | null
  fingerprint?: string | null
  error?: string | null
  changed: boolean
}

/** Lightweight official-page probe (ETag / Last-Modified / body hash). */
export async function probeOfficialSource(
  feed: Pick<
    SourceFeedRow,
    "official_url" | "official_api_url" | "last_etag" | "last_modified_header" | "content_fingerprint"
  >,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedCheckResult> {
  const url = (feed.official_api_url || feed.official_url).trim()
  if (!isOfficialRefreshUrl(url)) {
    return {
      status: "skipped",
      changed: false,
      error: "URL is not an allowed official host; refusing third-party refresh.",
    }
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "UloAskUloSourceRefresh/1.0 (+official-source-check)",
    }
    if (feed.last_etag) headers["If-None-Match"] = feed.last_etag
    if (feed.last_modified_header) {
      headers["If-Modified-Since"] = feed.last_modified_header
    }

    const res = await fetchImpl(url, { method: "GET", headers, redirect: "follow" })
    const etag = res.headers.get("etag")
    const lastModified = res.headers.get("last-modified")

    if (res.status === 304) {
      return { status: "unchanged", changed: false, etag, lastModified }
    }
    if (!res.ok) {
      return {
        status: "error",
        changed: false,
        error: `HTTP ${res.status}`,
        etag,
        lastModified,
      }
    }

    const body = await res.text()
    const fingerprint = await sha256Hex(body.slice(0, 200_000))
    const changed =
      feed.content_fingerprint != null && feed.content_fingerprint !== fingerprint
    const status: FeedCheckResult["status"] = !feed.content_fingerprint
      ? "ok"
      : changed
        ? "changed"
        : "unchanged"
    return {
      status,
      changed,
      etag,
      lastModified,
      fingerprint,
    }
  } catch (err) {
    return {
      status: "error",
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
