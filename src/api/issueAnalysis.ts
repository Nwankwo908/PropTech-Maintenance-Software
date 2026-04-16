const API_URL = import.meta.env.VITE_ISSUE_CLARIFY_API_URL as
  | string
  | undefined

/** Supabase Edge Functions with verify_jwt require the anon key on the request. */
/** Below this length the clarify panel stays empty (avoid noise on a single character). */
export const ISSUE_CLARIFY_LOCAL_MIN_CHARS = 8

/** At or above this length we call the remote clarify API when configured. */
export const ISSUE_CLARIFY_REMOTE_MIN_CHARS = 28

/** When the description is between local and remote minimums, show these without calling the API. */
export function shortDescriptionNudgeQuestions(): string[] {
  return [
    'Which room or area is affected?',
    'When did you first notice the problem?',
    'Is anything leaking, making noise, sparking, or completely not working?',
    'Does it seem urgent, or can it wait a few days?',
    'Any safety concern (e.g. gas smell, exposed wiring)?',
  ]
}

function clarifyRequestHeaders(targetUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!anon) return headers
  try {
    const { hostname } = new URL(targetUrl)
    if (hostname.endsWith('.supabase.co')) {
      headers.Authorization = `Bearer ${anon}`
      headers.apikey = anon
    }
  } catch {
    /* ignore invalid URL */
  }
  return headers
}

/** Normalized extraction from resident free text (your AI should return these). */
export type IssueParsed = {
  issueType: string | null
  /** AI SLA bucket: plumbing | electrical | appliance | other (deterministic due time uses src/lib/slaRules). */
  issue_category?: string | null
  room: string | null
  appliance: string | null
  severity: string | null
  urgency: 'low' | 'normal' | 'urgent' | null
  normalizedSummary: string | null
}

export type IssueAnalysisResult = {
  questions: string[]
  parsed: IssueParsed | null
  /** Long-form prose for the review “AI-Generated Summary” when your API provides it. */
  aiSummary: string | null
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function coerceUrgency(v: unknown): 'low' | 'normal' | 'urgent' | null {
  const s = stringOrNull(v)
  if (!s) return null
  const t = s.toLowerCase()
  if (t === 'low' || t === 'low priority') return 'low'
  if (
    t === 'normal' ||
    t === 'normal priority' ||
    t === 'medium' ||
    t === 'standard'
  )
    return 'normal'
  if (
    t === 'urgent' ||
    t === 'high' ||
    t === 'emergency' ||
    t === 'critical'
  )
    return 'urgent'
  return null
}

function extractParsed(data: Record<string, unknown>): IssueParsed | null {
  const block =
    data.parsed !== null &&
    typeof data.parsed === 'object' &&
    !Array.isArray(data.parsed)
      ? (data.parsed as Record<string, unknown>)
      : data

  const issueType =
    stringOrNull(block.issueType) ??
    stringOrNull(block.issue_type) ??
    stringOrNull(block.category) ??
    stringOrNull(block.issueCategory)

  const issue_category =
    stringOrNull(block.issue_category) ?? stringOrNull(block.issueCategory)

  const room =
    stringOrNull(block.room) ??
    stringOrNull(block.location) ??
    stringOrNull(block.area)

  const appliance =
    stringOrNull(block.appliance) ??
    stringOrNull(block.equipment) ??
    stringOrNull(block.device)

  const severity =
    stringOrNull(block.severity) ?? stringOrNull(block.impact)

  const urgency =
    coerceUrgency(block.urgency) ??
    coerceUrgency(block.priority) ??
    coerceUrgency(block.urgencyLevel)

  const normalizedSummary =
    stringOrNull(block.normalizedSummary) ??
    stringOrNull(block.normalized_summary) ??
    stringOrNull(block.summary) ??
    stringOrNull(block.cleanDescription)

  if (
    !issueType &&
    !issue_category &&
    !room &&
    !appliance &&
    !severity &&
    !urgency &&
    !normalizedSummary
  ) {
    return null
  }

  return {
    issueType,
    issue_category,
    room,
    appliance,
    severity,
    urgency,
    normalizedSummary,
  }
}

function extractAiSummary(data: Record<string, unknown>): string | null {
  const fromBlock = (block: Record<string, unknown>): string | null =>
    stringOrNull(block.aiSummary) ??
    stringOrNull(block.ai_summary) ??
    stringOrNull(block.reviewSummary) ??
    stringOrNull(block.review_summary) ??
    stringOrNull(block.generatedSummary) ??
    stringOrNull(block.generated_summary) ??
    stringOrNull(block.maintenanceSummary) ??
    stringOrNull(block.executiveSummary)

  const top = fromBlock(data)
  if (top) return top

  if (
    data.parsed !== null &&
    typeof data.parsed === 'object' &&
    !Array.isArray(data.parsed)
  ) {
    return fromBlock(data.parsed as Record<string, unknown>)
  }

  return null
}

function extractQuestions(data: Record<string, unknown>): string[] {
  const raw = data.questions ?? data.followUpQuestions
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 6)
}

/**
 * POST `{ description }` to your backend. It should call your AI and return JSON, for example:
 * ```json
 * {
 *   "questions": ["Is water still running?", "..."],
 *   "issueType": "Plumbing",
 *   "room": "Kitchen",
 *   "appliance": "Sink",
 *   "severity": "moderate",
 *   "urgency": "normal",
 *   "normalizedSummary": "Kitchen sink leaking under cabinet.",
 *   "aiSummary": "**HVAC Issue** … **Estimated Response Time:** … **Recommended Action:** …"
 * }
 * ```
 * Or nest structured fields under `"parsed": { ... }`. Optional `aiSummary` (or `reviewSummary` /
 * `generatedSummary`) is shown verbatim on the review step; otherwise the app builds a summary from `parsed`.
 * Never expose model API keys in the browser — proxy through your server.
 * For Supabase-hosted functions with `verify_jwt = true`, set `VITE_SUPABASE_ANON_KEY`; the client adds
 * `Authorization` / `apikey` automatically when the clarify URL host ends with `.supabase.co`.
 *
 * Between `ISSUE_CLARIFY_LOCAL_MIN_CHARS` and `ISSUE_CLARIFY_REMOTE_MIN_CHARS`, returns local nudge
 * questions only (no network). At or above the remote minimum, calls the API when `VITE_ISSUE_CLARIFY_API_URL` is set.
 */
export async function fetchIssueAnalysis(
  description: string,
  signal?: AbortSignal,
): Promise<IssueAnalysisResult> {
  const trimmed = description.trim()
  if (trimmed.length < ISSUE_CLARIFY_LOCAL_MIN_CHARS) {
    return { questions: [], parsed: null, aiSummary: null }
  }

  if (trimmed.length < ISSUE_CLARIFY_REMOTE_MIN_CHARS) {
    return {
      questions: shortDescriptionNudgeQuestions(),
      parsed: null,
      aiSummary: null,
    }
  }

  const url = API_URL?.trim()
  if (!url) {
    return { questions: [], parsed: null, aiSummary: null }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: clarifyRequestHeaders(url),
    body: JSON.stringify({ description: description.trim() }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    let msg = `Request failed (${res.status})`
    try {
      const j = JSON.parse(text) as { message?: string; error?: string }
      if (typeof j.message === 'string') msg = j.message
      else if (typeof j.error === 'string') msg = j.error
    } catch {
      if (text.length > 0 && text.length < 120) msg = text
    }
    throw new Error(msg)
  }

  const data = (await res.json()) as Record<string, unknown>
  return {
    questions: extractQuestions(data),
    parsed: extractParsed(data),
    aiSummary: extractAiSummary(data),
  }
}
