/**
 * Landlord emergency SMS summary. Only facts the resident stated.
 * Does not repeat the same problem, and does not add weather or advice.
 */
export function summarizeEmergencyForLandlord(text: string | null | undefined): string {
  const source = (text ?? "").replace(/\s+/g, " ").trim()
  if (!source) return "A resident reported an emergency."

  const facts: string[] = []
  const mentionsAc = /\b(a\/?c|air\s*condition\w*|cooling)\b/i.test(source)
  const willNotStart =
    /\b(won['’]?t|will not|does not|doesn['’]?t|isn['’]?t|not)\s+turn(?:ing)? on\b/i.test(
      source,
    )
  if (mentionsAc && willNotStart) facts.push("The AC is not turning on.")
  else if (mentionsAc) facts.push("The AC is not working.")

  const indoor = source.match(
    /\b(\d{2,3})\b(?:\s*(?:degrees|°?\s*f))?\s+inside\b/i,
  )
  if (indoor?.[1]) facts.push(`It is ${indoor[1]} F inside.`)

  if (/\bdizzy\b/i.test(source)) facts.push("Someone in the home feels dizzy.")
  else if (
    /\b(faint|unwell|nauseous|nausea|can'?t breathe|chest pain)\b/i.test(source)
  ) {
    facts.push("Someone in the home feels unwell.")
  }

  if (facts.length > 0) return facts.join(" ")

  const sentence = source.split(/(?<=[.!?])\s+/)[0] ?? source
  const clipped = sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}...` : sentence
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`
}
