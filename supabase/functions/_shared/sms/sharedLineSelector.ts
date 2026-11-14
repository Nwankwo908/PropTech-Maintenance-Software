/** Conservative account selectors. A selector is never evidence of sender membership. */
export function normalizeSharedLineAddress(value: string): string {
  const abbreviations: Record<string, string> = {
    street: "st",
    road: "rd",
    avenue: "ave",
    boulevard: "blvd",
    drive: "dr",
    lane: "ln",
    court: "ct",
    place: "pl",
    terrace: "ter",
    north: "n",
    south: "s",
    east: "e",
    west: "w",
  }
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/).map((word) => abbreviations[word] ?? word).join(" ")
}

export function sharedLineAddressReply(body: string): string {
  return normalizeSharedLineAddress(
    body.trim().replace(
      /^(?:(?:the\s+)?(?:property\s+)?address\s*(?:is|:)?\s*|(?:it['’]?s|at|for)\s+)/i,
      "",
    ),
  )
}

export function sharedLineWorkOrderSelector(body: string):
  | { kind: "none" }
  | { kind: "invalid" }
  | {
    kind: "work_order"
    prefix: string
    selectorOnly: boolean
    answerBody: string
  } {
  const pattern =
    /\bWO(?:\s*[-–—]\s*([a-z0-9]+)|\s+([a-z0-9]+)|([0-9a-f]{4,8})\b)/gi
  const matches = [...body.matchAll(pattern)]
  if (!matches.length) return { kind: "none" }
  const refs = [
    ...new Set(matches.map((m) => (m[1] ?? m[2] ?? m[3]).toLowerCase())),
  ]
  if (refs.length !== 1 || !/^[0-9a-f]{4,8}$/.test(refs[0])) {
    return { kind: "invalid" }
  }
  // Do not silently prefer a work order over a conflicting property selector.
  if (/\b(?:at|for|address|property)\s*(?:is|:)?\s+\d+\s+[a-z]/i.test(body)) {
    return { kind: "invalid" }
  }
  const answerBody = body.replace(pattern, " ").replace(/\s+/g, " ").trim()
  const rest = answerBody.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return {
    kind: "work_order",
    prefix: refs[0],
    selectorOnly: rest === "" || rest === "workorder",
    answerBody,
  }
}

export function isBareSharedLineAction(body: string): boolean {
  return /^(?:yes|no|approve|decline|accept|reject|[1-9][0-9]?)\s*[.!]?$/i.test(
    body.trim(),
  )
}
