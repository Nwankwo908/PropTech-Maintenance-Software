/** Best-effort parse of model JSON (handles fenced or prefixed prose). */
export function parseModelJsonContent(content: string, providerLabel: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error(`${providerLabel} returned empty content`)
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    // markdown code fence
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim())
    }

    // leading/trailing prose around a JSON object/array
    const objectStart = trimmed.indexOf("{")
    const objectEnd = trimmed.lastIndexOf("}")
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1))
    }

    const arrayStart = trimmed.indexOf("[")
    const arrayEnd = trimmed.lastIndexOf("]")
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1))
    }

    throw new Error(`${providerLabel} returned non-JSON content`)
  }
}
