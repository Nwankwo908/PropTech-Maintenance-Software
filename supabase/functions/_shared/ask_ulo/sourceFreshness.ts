/**
 * Code-owned freshness stamps and staleness caveats for allowlisted fact sources.
 * Never leave "as of" / "verify locally" to LLM discretion.
 */

/** Legal RAG / structured facts older than this get an explicit verify caveat. */
export const LEGAL_STALENESS_DAYS = 180

/** Incentives catalog publish date (update when PROGRAM_CATALOG changes). */
export const INCENTIVES_CATALOG_AS_OF = "2026-07-01"

/** Incentives older than this (vs catalog as-of) force verify-with-agency caveat. */
export const INCENTIVES_STALENESS_DAYS = 90

export function daysBetween(isoDate: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!m) return null
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(then)) return null
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((nowUtc - then) / (24 * 60 * 60 * 1000))
}

export function isStale(
  isoDate: string | null | undefined,
  thresholdDays: number,
  now: Date = new Date(),
): boolean {
  if (!isoDate) return true
  const days = daysBetween(isoDate, now)
  if (days == null) return true
  return days > thresholdDays
}

export function formatLegalFreshnessLines(input: {
  currencyDate: string | null
  now?: Date
}): string[] {
  const lines: string[] = []
  if (input.currencyDate) {
    lines.push(
      `- **Information current as of:** ${input.currencyDate} (from cited materials)`,
    )
    if (isStale(input.currencyDate, LEGAL_STALENESS_DAYS, input.now)) {
      lines.push(
        `- **Freshness:** This cited material is more than **${LEGAL_STALENESS_DAYS} days** old — verify the current rule with your local jurisdiction or counsel before acting.`,
      )
    }
  } else {
    lines.push(
      "- **Information current as of:** see cited materials’ effective / update dates in View details",
    )
    lines.push(
      "- **Freshness:** I couldn’t confirm a recent update date on the citations — verify with your local jurisdiction before relying on this for a decision.",
    )
  }
  return lines
}

export function formatIncentivesFreshnessFooter(input?: { now?: Date }): string {
  const asOf = INCENTIVES_CATALOG_AS_OF
  const lines = [
    "",
    "---",
    "",
    "## Source currency",
    `- **Catalog as of:** ${asOf}`,
  ]
  if (isStale(asOf, INCENTIVES_STALENESS_DAYS, input?.now)) {
    lines.push(
      `- **Freshness:** This orientation catalog is more than **${INCENTIVES_STALENESS_DAYS} days** old — confirm current eligibility and deadlines on each agency’s official page (or with your CPA) before applying.`,
    )
  } else {
    lines.push(
      "- Programs change on agency schedules — always confirm current terms on the official link before applying.",
    )
  }
  return lines.join("\n")
}
