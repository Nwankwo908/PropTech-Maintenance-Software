/**
 * Tenant SMS after they close a repair.
 * The request title is never placed after "your", so a full sentence
 * does not read as "your The kitchen faucet is dripping."
 */

const ADJECTIVE =
  "dripping|leaking|leaky|broken|clogged|sparking|running|flooding|overflowing"

const WITH_IS = new RegExp(
  `^(?:the\\s+)?(.+?)\\s+(?:is|are)\\s+(${ADJECTIVE})$`,
  "i",
)
const TRAILING_ADJECTIVE = new RegExp(
  `^(?:the\\s+)?(.+?)\\s+(${ADJECTIVE})$`,
  "i",
)

function residentRequestTitle(description: string | null | undefined): string {
  const raw = (description ?? "").trim()
  if (!raw) return ""
  const firstLine = raw.split("\n").map((line) => line.trim()).find(Boolean) ?? ""
  if (/^resident closed this request/i.test(firstLine)) return ""
  const sentence = firstLine.split(/(?<=[.!?])\s+/)[0]?.trim() ?? ""
  const cleaned = sentence.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim()
  if (!cleaned || /^open request$/i.test(cleaned) || /^wo-/i.test(cleaned)) return ""
  return cleaned
}

function looksLikeSentence(title: string): boolean {
  return /\b(is|are|was|were|isn't|aren't|won't|can't|cannot|doesn't|don't|didn't|has|have|hasn't|not)\b/i
    .test(title)
}

function soften(text: string): string {
  return text.split(/\s+/).filter(Boolean).map((word) => {
    if (/^(?:ac|hvac)$/i.test(word)) return word.toUpperCase()
    return word.charAt(0).toLowerCase() + word.slice(1)
  }).join(" ")
}

function withArticle(phrase: string): string {
  const soft = soften(phrase)
  if (/^(?:a|an|the)\s/i.test(soft) || /^no\s/i.test(soft)) return soft
  return `the ${soft}`
}

function nounFromAdjective(title: string): string | null {
  const match = title.match(WITH_IS) ?? title.match(TRAILING_ADJECTIVE)
  if (!match?.[1] || !match[2]) return null
  const noun = match[1].trim()
  if (!noun || /^(?:something|it|this|that)$/i.test(noun)) return null
  return withArticle(`${match[2]} ${noun}`)
}

function ensureSentence(title: string): string {
  const trimmed = title.trim()
  const sentence = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

export function buildResidentRepairClosedSms(input: {
  description?: string | null
  requestRef?: string | null
}): string {
  const title = residentRequestTitle(input.description)
  const ref = (input.requestRef ?? "").trim().toUpperCase()
  const refBit = /^[0-9A-F]{8,32}$/.test(ref) ? ` Ref: ${ref}.` : ""
  const noun = title ? nounFromAdjective(title) : null

  let body = "Thanks for letting us know. We've closed your request."
  if (noun) {
    body = `Thanks for letting us know. We've closed your request for ${noun}.`
  } else if (title && looksLikeSentence(title)) {
    body = `Thanks for letting us know. We've closed your request. ${ensureSentence(title)}`
  } else if (title) {
    body = `Thanks for letting us know. We've closed your request for ${withArticle(title)}.`
  }

  return `${body}${refBit}`.replace(/[ \t]+/g, " ").trim()
}
