/**
 * Prepared answers stay on counts and cards.
 * When a question asks for a fact that is in the resident's report, that fact
 * has to be in the answer. A model call does not replace a missing record.
 */

export function reportedDetailLine(workOrder: {
  title?: string | null
  description?: string | null
  reportedDetail?: string | null
}): string | null {
  const raw = (workOrder.reportedDetail ?? "").replace(/\s+/g, " ").trim()
  if (!raw) return null
  const label = (workOrder.title || workOrder.description || "").replace(/\s+/g, " ").trim().toLowerCase()
  if (label && raw.toLowerCase() === label) return null
  return raw.slice(0, 400)
}

/** A specific reported fact. Counts stay prepared; these answers are written from the record. */
export function isDetailedRecordQuestion(question: string): boolean {
  return /\b(temperature|degrees|how hot|how cold|dizzy|unwell|who feels|gas|smell|what was reported|what did (the )?(resident|tenant) say)\b/i.test(question)
}

/** True when a prepared answer already contains the fact the question asked for. */
export function preparedAnswerCoversAskedFacts(question: string, answer: string): boolean {
  const q = question.toLowerCase()
  const a = answer.toLowerCase()
  if (/\b(temperature|degrees|how hot|how cold)\b/.test(q) && !/\b\d{2,3}\b/.test(a)) return false
  if (/\b(dizzy|unwell|who feels)\b/.test(q) && !/\b(dizzy|unwell|son|sick|feel)\b/.test(a)) return false
  if (/\bgas\b|\bsmell\b/.test(q) && !/\bgas\b/.test(a)) return false
  return true
}

const RECORD_SUBJECT_STOP = new Set([
  "temperature", "degrees", "indoor", "recorded", "problem", "request", "maintenance",
  "house", "property", "about", "what", "hot", "cold", "feel", "feels", "unwell",
  "dizzy", "resident", "tenant", "reported", "open", "work", "order", "there",
  "this", "that", "with", "from", "have", "does", "says", "test", "which", "where",
  "when", "your",
])

const RECORD_SUBJECT_GROUPS = [
  ["hvac", "heating", "cooling", "air conditioning", "air-conditioning", "ac", "furnace"],
  ["plumbing", "plumb", "leak", "faucet", "drain", "toilet", "sink", "water"],
  ["electrical", "electric", "outlet", "breaker", "sparking"],
  ["gas", "smell"],
]

function recordHasTerm(record: string, term: string): boolean {
  if (term.length <= 3) return new RegExp(`\\b${term}\\b`, "i").test(record)
  return record.toLowerCase().includes(term)
}

/** A retrieved card has to be about the same subject, not merely contain some number. */
export function retrievedRecordMatchesQuestionSubject(question: string, record: string): boolean {
  const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !RECORD_SUBJECT_STOP.has(word))
  if (tokens.length === 0) return true
  return tokens.some((token) => {
    const group = RECORD_SUBJECT_GROUPS.find((terms) => terms.some((term) => term === token || term.includes(token) || token.includes(term)))
    if (group) return group.some((term) => recordHasTerm(record, term))
    return record.toLowerCase().includes(token)
  })
}

export function isUploadedDocumentQuestion(question: string): boolean {
  return /\b(uploaded|pdf|attachment)\b/i.test(question) && /\b(lease|document|policy|report|rent)\b/i.test(question)
}

export function answerFromUploadedText(question: string, text: string): string | null {
  const body = text.replace(/\s+/g, " ").trim()
  if (!body) return null
  const sentences = body.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
  const wantsRent = /\brent\b/i.test(question)
  const hit = sentences.find((sentence) => {
    if (wantsRent) return /\brent\b/i.test(sentence)
    const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5 && !/^(uploaded|lease|document|policy|report|about|what|does|says)$/.test(word))
    return words.length > 0 && words.some((word) => sentence.toLowerCase().includes(word))
  }) ?? null
  if (!hit) return null
  return `The uploaded document says: ${hit}`
}
