/**
 * Work-order context: staff-facing summary, category, room, location detail
 * and urgency, derived from the tenant's description (or an HQS line item).
 *
 * - `deriveContextHeuristic` is pure and deterministic (no network). It is the
 *   fallback and is good enough on its own for HQS items.
 * - `summarizeWorkOrder` calls an LLM when an OpenAI / Gemini / Anthropic key
 *   is set (see pickProvider) and falls back to the heuristic on any error.
 * - `ensureWorkOrderContext` caches the result on the row (summary_source_hash)
 *   so each description is summarized once, not on every reminder.
 */

export type Urgency = "emergency" | "safety" | "routine"
export type Category =
  | "plumbing"
  | "electrical"
  | "pest"
  | "appliance"
  | "hvac"
  | "safety"
  | "interior"
  | "exterior"
  | "general"

export interface WorkOrderContext {
  summary: string
  category: Category
  room: string | null
  location_detail: string | null
  urgency: Urgency
  source: "llm" | "heuristic"
}

const CATEGORIES: Category[] = [
  "plumbing", "electrical", "pest", "appliance", "hvac",
  "safety", "interior", "exterior", "general",
]
const URGENCIES: Urgency[] = ["emergency", "safety", "routine"]

export const SUMMARY_MAX = 90

// ---------------------------------------------------------------------------
// Keyword tables (order matters: first match wins)
// ---------------------------------------------------------------------------

const ROOM_RULES: Array<[RegExp, string]> = [
  [/\bbath(room)?\b|\btub\b|\bbathtub\b|\bshower\b|\btoilet\b|\bvanity\b/i, "Bathroom"],
  [/\bkitchen\b|\bstove\b|\boven\b|\brange\b|\bfridge\b|\brefrigerator\b|\bdishwasher\b|\bgarbage disposal\b/i, "Kitchen"],
  [/\bbed ?room\b/i, "Bedroom"],
  [/\bliving ?room\b/i, "Living room"],
  [/\blaundry\b|\bwasher\b|\bdryer\b/i, "Laundry"],
  [/\bbasement\b|\bcrawl ?space\b/i, "Basement"],
  [/\bwater heater\b|\bdischarge line\b|\bt ?& ?p\b/i, "Water heater"],
  [/\bexterior\b|\bporch\b|\bstairs\b|\brails?\b|\broof\b|\bgutters?\b|\bsiding\b|\byard\b|\bdriveway\b/i, "Exterior"],
  [/\bhall(way)?\b/i, "Hallway"],
]

const CATEGORY_RULES: Array<[RegExp, Category]> = [
  [/\bsmoke (detector|alarm)s?\b|\bcarbon monoxide\b|\bco detector\b|\bsecurity\b|\block(s)?\b/i, "safety"],
  [/\bpests?\b|\bexterminat|\broach|\bmice\b|\bmouse\b|\brats?\b|\bbed ?bugs?\b|\bants\b|\btermite/i, "pest"],
  [/\bleak|\bsink\b|\btoilet\b|\bpipe|\bdrain|\bfaucet|\bclog|\bplumbing\b|\bwater heater\b|\bdischarge line\b|\bbathtub\b|\btub\b|\bshower\b/i, "plumbing"],
  [/\belectric|\boutlet|\bbreaker|\bwiring\b|\bwires?\b|\bsparks?|\blight (fixture|switch)\b|\bpower\b/i, "electrical"],
  [/\bheat(ing|er)?\b|\bfurnace\b|\ba\/?c\b|\bair condition|\bhvac\b|\bthermostat\b/i, "hvac"],
  [/\bappliance|\bstove\b|\boven\b|\brange\b|\bfridge\b|\brefrigerator\b|\bdishwasher\b|\bwasher\b|\bdryer\b|\bmicrowave\b/i, "appliance"],
  [/\bexterior\b|\bporch\b|\bstairs\b|\brails?\b|\broof\b|\bgutters?\b|\bsiding\b|\bgarbage\b|\bdebris\b/i, "exterior"],
  [/\bwall|\bceiling|\bpaint|\bdoor|\bwindow|\bfloor(ing)?\b|\bcabinet|\bdrawer|\bpatch/i, "interior"],
]

const EMERGENCY_RE =
  /\bleak(ing)? (bad|badly|everywhere)\b|\bflood|\bburst\b|\bsewage\b|\bgas (smell|leak)\b|\bsmell(s)? gas\b|\bno heat\b|\bno water\b|\bno power\b|\bsparks?|\bsparking\b|\bsmoke\b(?! detector| alarm)|\bfire\b|\bceiling (fell|collapsed)\b/i

const SAFETY_RE =
  /\bsmoke (detector|alarm)|\bcarbon monoxide\b|\bco detector\b|\bsecurity\b|\bstairs\b|\brails?\b|\bexposed wir|\bdischarge line\b|\bdoesn'?t lock\b|\bwon'?t lock\b/i

// Words to drop from the front of tenant messages.
const PREAMBLE_RE =
  /^(?:(?:hi|hello|hey|good (?:morning|afternoon|evening)|dear \w+|thanks?|thank you)[\s,.!-]*(?:and\s+thank\s+you)?[\s,.!-]*)+/i
const SOFTENER_RE =
  /^(?:i was (?:trying|wondering|hoping) to (?:see|ask|find out) if|i was wondering if|i wanted to (?:let you know|ask|report)(?: that)?|i(?:'m| am) (?:writing|reaching out) (?:to|because)(?: let you know)?(?: that)?|just wanted to (?:let you know|say)(?: that)?|can you (?:please )?(?:let me know if)?|please)\s+/i

// ---------------------------------------------------------------------------
// HQS line items, e.g.
//   "HQS fail: Bedroom (Left, Front, Floor: 2) - Security"
//   "HQS fail: Kitchen - Stove or Range with Oven"
//   "HQS fail: Deteriorated Bathtub-(Re-Glaze)"
// ---------------------------------------------------------------------------

export interface HqsItem {
  area: string | null
  position: string | null
  item: string
}

export function parseHqsDescription(description: string): HqsItem | null {
  const m = description.trim().match(/^HQS\s+fail:\s*(.+)$/i)
  if (!m) return null
  const body = m[1].trim()

  const split = body.match(/^(.+?)\s+-\s+(.+)$/)
  if (!split) return { area: null, position: null, item: body }

  let area = split[1].trim()
  let position: string | null = null
  const pos = area.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  if (pos) {
    area = pos[1].trim()
    position = formatHqsPosition(pos[2])
  }
  return { area, position, item: split[2].trim() }
}

function formatHqsPosition(raw: string): string | null {
  // "Left, Front, Floor: 2" -> "left front, floor 2"
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean)
  const where: string[] = []
  let floor: string | null = null
  for (const p of parts) {
    const f = p.match(/^floor:?\s*(-?\d+)$/i)
    if (f) floor = f[1]
    else if (!/^center$/i.test(p)) where.push(p.toLowerCase())
  }
  const out: string[] = []
  if (where.length) out.push(where.join(" "))
  if (floor != null && floor !== "0") out.push(`floor ${floor}`)
  return out.length ? out.join(", ") : null
}

// ---------------------------------------------------------------------------
// Heuristic derivation
// ---------------------------------------------------------------------------

function firstMatch<T>(text: string, rules: Array<[RegExp, T]>): T | null {
  for (const [re, v] of rules) if (re.test(text)) return v
  return null
}

/** Cut at a word boundary, never mid-word ("a metal pi" -> "a metal…"). */
export function truncateWords(text: string, max = SUMMARY_MAX): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "") + "…"
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Clean a tenant message into a short, staff-facing line without an LLM. */
export function heuristicSummary(description: string): string {
  let t = description.replace(/\s+/g, " ").trim()
  t = t.replace(PREAMBLE_RE, "")
  // Keep as many substantive sentences as fit, joined with "; ".
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.replace(/[^a-z]/gi, "").length > 3)
    .map((s) =>
      s.replace(SOFTENER_RE, "")
        .replace(/^(?:an?|the)\s+(\w+)\s+(?:can|could)\s+come(?:\s+out)?\s+to\s+/i, "Requesting $1 to ")
        .replace(/^(?:my|the)\s+/i, "")
        .replace(/^and\s+/i, "")
        .replace(/[.!?]+$/, "")
        .trim(),
    )
  if (!sentences.length) return capitalize(truncateWords(t))
  let out = sentences[0]
  for (const s of sentences.slice(1)) {
    if (`${out}; ${s}`.length > SUMMARY_MAX) break
    out = `${out}; ${s.charAt(0).toLowerCase()}${s.slice(1)}`
  }
  // If only one sentence fit and there is more, still show the start of the next.
  if (out === sentences[0] && sentences.length > 1 && out.length < SUMMARY_MAX - 20) {
    out = `${out}; ${sentences[1].charAt(0).toLowerCase()}${sentences[1].slice(1)}`
  }
  return capitalize(truncateWords(out))
}

export function deriveContextHeuristic(description: string): WorkOrderContext {
  const hqs = parseHqsDescription(description)
  const text = description

  if (hqs) {
    const scope = `${hqs.area ?? ""} ${hqs.item}`
    const roomFromArea =
      hqs.area && !/^(other|general health and safety|heating and plumbing)$/i.test(hqs.area)
        ? hqs.area.replace(/^building exterior$/i, "Exterior")
        : null
    const room = roomFromArea ?? firstMatch(scope, ROOM_RULES)
    const category = firstMatch(scope, CATEGORY_RULES) ?? "general"
    const urgency: Urgency = EMERGENCY_RE.test(scope) ? "emergency" : SAFETY_RE.test(scope) ? "safety" : "routine"
    const item = hqs.item.replace(/-\(/g, " (").replace(/\s+/g, " ")
    return {
      summary: truncateWords(`HQS fail: ${item}`),
      category,
      room,
      location_detail: hqs.position,
      urgency,
      source: "heuristic",
    }
  }

  const category = firstMatch(text, CATEGORY_RULES) ?? "general"
  const urgency: Urgency = EMERGENCY_RE.test(text) ? "emergency" : SAFETY_RE.test(text) ? "safety" : "routine"
  return {
    summary: heuristicSummary(text),
    category,
    room: firstMatch(text, ROOM_RULES),
    location_detail: null,
    urgency,
    source: "heuristic",
  }
}

// ---------------------------------------------------------------------------
// LLM summary (optional)
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
  // Works in Supabase Edge (Deno) and in Node scripts/tests.
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any
  return g.Deno?.env?.get?.(name) ?? g.process?.env?.[name]
}

const SYSTEM_PROMPT = `You turn tenant maintenance requests into structured data for a property manager.
Return ONLY a JSON object with these keys:
- "summary": one line, max ${SUMMARY_MAX} characters, starts with the problem, mentions the room and anything urgent (active leak, damage, no heat, safety). No greetings, no "tenant says", no quotes. If the description lists more than one issue, mention each briefly.
- "category": one of ${CATEGORIES.join(", ")}
- "room": one of Kitchen, Bathroom, Bedroom, Living room, Dining room, Laundry, Basement, Hallway, Exterior, Whole unit, or null. Use the value written after "Affected area:" when present — never output the words "Affected area" themselves.
- "location_detail": where in that room (e.g. "under vanity", "ceiling above tub"), or null if not stated
- "urgency": "emergency" (active water damage, no heat/water/power, gas, fire, sewage), "safety" (smoke/CO detectors, locks, stairs/rails, exposed wiring), otherwise "routine"
Never invent a room or location the request does not support.
Descriptions may include appended lines like 'Tenant update:', 'Affected area:', 'entry if not home:', 'Opened via backfill...' or scheduling notes. Merge tenant updates into the summary, use 'Affected area' for room, and ignore system/metadata text.`

type Provider = "openai" | "gemini" | "anthropic"

function pickProvider(): { provider: Provider; apiKey: string } | null {
  const forced = env("WORK_ORDER_SUMMARY_PROVIDER")?.toLowerCase() as Provider | undefined
  const keys: Record<Provider, string | undefined> = {
    openai: env("OPENAI_API_KEY"),
    gemini: env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
  }
  if (forced && keys[forced]) return { provider: forced, apiKey: keys[forced]! }
  for (const p of ["openai", "gemini", "anthropic"] as Provider[]) {
    if (keys[p]) return { provider: p, apiKey: keys[p]! }
  }
  return null
}

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-4.1-nano",
  gemini: "gemini-2.5-flash-lite",
  anthropic: "claude-haiku-5-5",
}

async function callProvider(
  provider: Provider,
  apiKey: string,
  model: string,
  userText: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  if (provider === "openai") {
    const res = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
      }),
    })
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ""
  }

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    const res = await doFetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 300 },
      }),
    })
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts ?? []
    return parts.map((p) => p.text ?? "").join("")
  }

  const res = await doFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data?.content?.find((c: { type: string }) => c.type === "text")?.text ?? ""
}

export async function summarizeWorkOrder(
  description: string,
  opts: { fetchImpl?: typeof fetch; model?: string; timeoutMs?: number } = {},
): Promise<WorkOrderContext> {
  const fallback = deriveContextHeuristic(description)
  if (parseHqsDescription(description)) return fallback

  const picked = pickProvider()
  if (!picked) return fallback

  const model = opts.model ?? env("WORK_ORDER_SUMMARY_MODEL") ?? DEFAULT_MODEL[picked.provider]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  try {
    const text = await callProvider(picked.provider, picked.apiKey, model, description.slice(0, 4000), opts.fetchImpl ?? fetch, controller.signal)
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) {
      console.warn(`[workOrderContext] ${picked.provider} returned no JSON; using keyword fallback`)
      return fallback
    }
    return validateLlmContext(JSON.parse(json), fallback)
  } catch (err) {
    console.warn(`[workOrderContext] ${picked.provider}/${model} failed; using keyword fallback:`, String(err))
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

const DISCARD_PLACEHOLDER_RE = /affected area|^n\/?a$|^unknown$/i

function sentenceCaseRoom(room: string): string {
  const t = room.trim().replace(/\s+/g, " ")
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function validateLlmContext(raw: Record<string, unknown>, fallback: WorkOrderContext): WorkOrderContext {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  const summary = str(raw.summary)
  if (!summary) return fallback
  const category = CATEGORIES.includes(raw.category as Category) ? (raw.category as Category) : fallback.category
  const urgency = URGENCIES.includes(raw.urgency as Urgency) ? (raw.urgency as Urgency) : fallback.urgency

  let room = str(raw.room)
  if (room && DISCARD_PLACEHOLDER_RE.test(room)) room = null
  room = room ? sentenceCaseRoom(room) : null

  let locationDetail = str(raw.location_detail)
  if (locationDetail && DISCARD_PLACEHOLDER_RE.test(locationDetail)) locationDetail = null

  return {
    summary: truncateWords(summary),
    category,
    room: room ?? fallback.room,
    location_detail: locationDetail,
    // Never let the model downgrade a keyword-detected emergency/safety issue.
    urgency: rankUrgency(urgency) >= rankUrgency(fallback.urgency) ? urgency : fallback.urgency,
    source: "llm",
  }
}

export function rankUrgency(u: Urgency | null | undefined): number {
  return u === "emergency" ? 2 : u === "safety" ? 1 : 0
}

// ---------------------------------------------------------------------------
// Caching on the row
// ---------------------------------------------------------------------------

export async function hashDescription(description: string): Promise<string> {
  const bytes = new TextEncoder().encode(description.trim())
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
}

export interface ContextRow {
  id: string
  description: string
  summary?: string | null
  category?: string | null
  room?: string | null
  location_detail?: string | null
  /** Staff digest urgency (DB column `context_urgency`). */
  context_urgency?: string | null
  /** @deprecated Prefer context_urgency — kept for callers that still pass urgency. */
  urgency?: string | null
  summary_source_hash?: string | null
}

// Minimal shape of the supabase-js client we use, to avoid a hard import here.
interface SupabaseLike {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): PromiseLike<{ error: unknown }>
    }
  }
}

/**
 * Returns the row's context, generating and saving it if missing or stale.
 * Call this when a request is created/edited, and defensively before sending
 * any reminder (it is a no-op when the cached summary is current).
 */
export async function ensureWorkOrderContext(
  supabase: SupabaseLike,
  row: ContextRow,
): Promise<WorkOrderContext> {
  const hash = await hashDescription(row.description)
  // Resident-facing `urgency` is low|normal|urgent — never treat it as staff context.
  const cachedUrgency = row.context_urgency ?? (
    URGENCIES.includes(row.urgency as Urgency) ? row.urgency : null
  )
  if (row.summary && row.summary_source_hash === hash) {
    return {
      summary: row.summary,
      category: (CATEGORIES.includes(row.category as Category) ? row.category : "general") as Category,
      room: row.room ?? null,
      location_detail: row.location_detail ?? null,
      urgency: (URGENCIES.includes(cachedUrgency as Urgency) ? cachedUrgency : "routine") as Urgency,
      source: "llm",
    }
  }
  const ctx = await summarizeWorkOrder(row.description)
  // Write context_urgency — not urgency (that column is resident low|normal|urgent).
  const { error } = await supabase
    .from("maintenance_requests")
    .update({
      summary: ctx.summary,
      category: ctx.category,
      room: ctx.room,
      location_detail: ctx.location_detail,
      context_urgency: ctx.urgency,
      summary_source_hash: hash,
      summarized_at: new Date().toISOString(),
    })
    .eq("id", row.id)
  if (error) console.warn("[workOrderContext] failed to cache context", row.id, error)
  return ctx
}

/**
 * Run ensureWorkOrderContext off the request path.
 * Prefer EdgeRuntime.waitUntil when available so the isolate stays alive;
 * otherwise fire-and-forget with a logged catch.
 */
export function queueWorkOrderContext(
  supabase: SupabaseLike,
  row: ContextRow,
  logLabel = "[workOrderContext]",
): void {
  const run = ensureWorkOrderContext(supabase, row).catch((err) => {
    console.warn(logLabel, row.id, err)
  })
  try {
    // deno-lint-ignore no-explicit-any
    const edgeRuntime = (globalThis as any).EdgeRuntime
    if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
      edgeRuntime.waitUntil(run)
      return
    }
  } catch {
    // Node / tests — fall through to void
  }
  void run
}
