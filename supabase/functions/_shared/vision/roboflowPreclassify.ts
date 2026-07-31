/**
 * Optional Roboflow pre-classifier for inspection photos.
 * Best-effort: when unconfigured or failing, analysis continues with the LLM only.
 *
 * Env:
 *   ROBOFLOW_API_KEY
 *   ROBOFLOW_MODEL_ID   — "project/version" or "workspace/project/version"
 *   ROBOFLOW_CONFIDENCE — 0–1, default 0.45
 *   ROBOFLOW_API_URL    — default https://serverless.roboflow.com
 *   ROBOFLOW_ENABLED    — "false" to disable even when key/model are set
 */
import type { VisionHintCategory } from "./types.ts"

export type RoboflowPrediction = {
  className: string
  confidence: number
}

export type RoboflowPreclassifyResult = {
  hintCategory: VisionHintCategory | null
  confidence: number
  topClass: string | null
  predictions: RoboflowPrediction[]
  latencyMs: number
  modelId: string
  /** Human-readable note for LLM / review UI */
  note: string
}

function stripDataUrl(imageBase64: string): string {
  return imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
}

function asConfidenceThreshold(): number {
  const raw = Deno.env.get("ROBOFLOW_CONFIDENCE")?.trim()
  if (!raw) return 0.45
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0.45
  // Accept 0–1 or 0–100
  if (n > 1) return Math.min(1, Math.max(0, n / 100))
  return Math.min(1, Math.max(0, n))
}

function normalizeModelPath(modelId: string): string {
  // "project/3" or "workspace/project/3"
  return modelId.replace(/^\/+|\/+$/g, "")
}

/** Map Roboflow class labels onto our VisionHintCategory. */
export function mapRoboflowClassToHint(className: string): VisionHintCategory | null {
  const c = className.trim().toLowerCase().replace(/[_\s]+/g, "-")
  if (!c) return null

  if (
    c.includes("boiler") ||
    c === "combi" ||
    c.includes("combi-boiler") ||
    c.includes("steam-boiler")
  ) {
    return "boiler"
  }
  if (
    c.includes("water-heater") ||
    c.includes("waterheater") ||
    c.includes("tankless") ||
    c === "hot-water-heater" ||
    (c.includes("heater") && !c.includes("space") && !c.includes("room"))
  ) {
    return "water_heater"
  }
  if (
    c.includes("hvac") ||
    c.includes("furnace") ||
    c.includes("condenser") ||
    c.includes("heat-pump") ||
    c.includes("air-condition") ||
    c === "ac" ||
    c === "ac-unit" ||
    c.includes("air-handler")
  ) {
    return "hvac"
  }
  if (c.includes("roof") || c.includes("shingle") || c.includes("flashing")) {
    return "roof"
  }
  if (
    c.includes("fridge") ||
    c.includes("refrigerat") ||
    c.includes("washer") ||
    c.includes("dryer") ||
    c.includes("stove") ||
    c.includes("range") ||
    c.includes("oven") ||
    c.includes("microwave") ||
    c.includes("dishwasher") ||
    c === "appliance"
  ) {
    return "appliance"
  }
  return null
}

function parsePredictions(json: unknown): RoboflowPrediction[] {
  if (!json || typeof json !== "object") return []
  const o = json as Record<string, unknown>
  const list = Array.isArray(o.predictions) ? o.predictions : []
  const out: RoboflowPrediction[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const p = raw as Record<string, unknown>
    const className =
      typeof p.class === "string"
        ? p.class
        : typeof p.class_name === "string"
          ? p.class_name
          : typeof p.label === "string"
            ? p.label
            : ""
    let confidence =
      typeof p.confidence === "number"
        ? p.confidence
        : typeof p.confidence === "string"
          ? Number(p.confidence)
          : NaN
    if (!Number.isFinite(confidence)) continue
    if (confidence > 1) confidence = confidence / 100
    if (!className.trim()) continue
    out.push({ className: className.trim(), confidence })
  }
  out.sort((a, b) => b.confidence - a.confidence)
  return out
}

export function isRoboflowConfigured(): boolean {
  const enabled = (Deno.env.get("ROBOFLOW_ENABLED") ?? "true").trim().toLowerCase()
  if (enabled === "false" || enabled === "0" || enabled === "off") return false
  const key = Deno.env.get("ROBOFLOW_API_KEY")?.trim()
  const model = Deno.env.get("ROBOFLOW_MODEL_ID")?.trim()
  return Boolean(key && model)
}

/**
 * Run Roboflow inference and return a category hint when confidence clears the threshold.
 * Never throws — returns null on skip/failure.
 */
export async function preclassifyWithRoboflow(
  imageBase64: string,
): Promise<RoboflowPreclassifyResult | null> {
  if (!isRoboflowConfigured()) return null

  const apiKey = Deno.env.get("ROBOFLOW_API_KEY")!.trim()
  const modelId = normalizeModelPath(Deno.env.get("ROBOFLOW_MODEL_ID")!.trim())
  const baseUrl = (
    Deno.env.get("ROBOFLOW_API_URL")?.trim() || "https://serverless.roboflow.com"
  ).replace(/\/+$/, "")
  const threshold = asConfidenceThreshold()
  const started = Date.now()

  try {
    const url = `${baseUrl}/${modelId}?api_key=${encodeURIComponent(apiKey)}&confidence=${threshold}`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripDataUrl(imageBase64),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      console.warn(
        "[roboflow] infer failed",
        response.status,
        text.slice(0, 200),
      )
      return null
    }

    const json = await response.json()
    const predictions = parsePredictions(json)
    const latencyMs = Date.now() - started

    let hintCategory: VisionHintCategory | null = null
    let confidence = 0
    let topClass: string | null = null

    for (const pred of predictions) {
      if (pred.confidence < threshold) continue
      const mapped = mapRoboflowClassToHint(pred.className)
      if (!mapped) continue
      hintCategory = mapped
      confidence = pred.confidence
      topClass = pred.className
      break
    }

    const topLabels = predictions
      .slice(0, 3)
      .map((p) => `${p.className} ${(p.confidence * 100).toFixed(0)}%`)
      .join(", ")

    const note = hintCategory
      ? `Roboflow pre-classify: ${hintCategory} (class "${topClass}", ${(confidence * 100).toFixed(0)}%)${
        topLabels ? `; detections: ${topLabels}` : ""
      }.`
      : topLabels
        ? `Roboflow detections below threshold or unmapped: ${topLabels}.`
        : "Roboflow returned no detections."

    return {
      hintCategory,
      confidence,
      topClass,
      predictions,
      latencyMs,
      modelId,
      note,
    }
  } catch (err) {
    console.warn(
      "[roboflow] preclassify error",
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/** Resolve final LLM hint: user hint wins; Roboflow fills gaps. */
export function mergeHintCategory(
  userHint: string | null | undefined,
  roboflow: RoboflowPreclassifyResult | null,
): string | null {
  const user = userHint?.trim() || null
  if (user) return user
  return roboflow?.hintCategory ?? null
}
