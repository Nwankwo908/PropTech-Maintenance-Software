/**
 * One shared issue summary for landlord-facing titles and tenant confirmations.
 * Surfaces: work-order title, admin thread summary, mid-intake re-confirm,
 * pre-submit confirmation, multi-issue split candidate labels.
 */
import {
  containsGreetingOrPleasantry,
  extractIssueNounPhrase,
  stripTenantMessageFiller,
} from './issueNounPhrase.ts'
import { parseIntakeDescriptionParts } from './intakeDescriptionParse.ts'

export type IssueSummaryFormat = 'title' | 'summary'

export type GenerateIssueSummaryOptions = {
  format: IssueSummaryFormat
  /** Trade / category hint (e.g. pest_control, plumbing). */
  category?: string | null
  /** Char budget for `title` (default 50). Truncates at a word boundary. */
  maxChars?: number
  /** Word budget for `summary` (default 18). Truncates at a word boundary. */
  maxWords?: number
}

const DEFAULT_TITLE_CHARS = 50
const DEFAULT_SUMMARY_WORDS = 18

function stripTrailingPunct(text: string): string {
  return text.replace(/[.!?,;:]+$/g, '').trim()
}

function truncateAtWordBoundary(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const cut = trimmed.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  const base =
    lastSpace > Math.floor(maxChars * 0.45) ? cut.slice(0, lastSpace) : cut
  return `${stripTrailingPunct(base)}…`
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}…`
}

/** Short, already title-shaped statements pass through with light cleanup. */
export function isConciseIssueStatement(text: string): boolean {
  const cleaned = stripTenantMessageFiller(text).trim()
  if (!cleaned) return false
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  if (containsGreetingOrPleasantry(cleaned)) return false
  if (
    /\b(?:i\s+(?:was|am|have|had|need|needed|wanted|trying)|trying\s+to\s+see|wondering|thank)\b/i.test(
      cleaned,
    )
  ) {
    return false
  }
  return true
}

function enrichTitleCore(core: string, cleaned: string): string {
  const hay = cleaned.toLowerCase()
  let out = core

  if (/pest/i.test(out) && /\bexterminator\b/i.test(hay)) {
    out = 'Pest control — exterminator requested'
  } else if (/bathroom sink leak/i.test(out)) {
    const bits: string[] = []
    if (/\bvanity\b/i.test(hay)) bits.push('vanity')
    if (/\bfaucet\b/i.test(hay)) bits.push('faucet')
    if (bits.length > 0) {
      out = `Bathroom sink leak — ${bits.join(' and ')} damage`
    }
  } else if (/kitchen sink leak/i.test(out)) {
    out = 'Kitchen sink leak'
  }

  return out
}

function formatAsTitle(
  phrase: string,
  cleaned: string,
  maxChars: number,
  _passThrough: boolean,
): string {
  let core = stripTrailingPunct(phrase.replace(/^an?\s+/i, ''))
  if (!core) core = 'Maintenance issue'
  core = enrichTitleCore(core, cleaned)
  // Sentence case (first letter only) — not Title Case Every Word.
  return truncateAtWordBoundary(sentenceCasePreserve(core), maxChars)
}

function formatAsSummary(
  phrase: string,
  cleaned: string,
  maxWords: number,
  confidence: 'high' | 'low',
  passThrough: boolean,
): string {
  if (passThrough) {
    return truncateWords(stripTrailingPunct(cleaned), maxWords)
  }

  if (confidence === 'low') {
    const fallback = stripTrailingPunct(cleaned || phrase) || 'a maintenance issue'
    return truncateWords(fallback, maxWords)
  }

  const core = stripTrailingPunct(phrase) || 'a maintenance issue'
  return truncateWords(core, maxWords)
}

function alreadyMatchesExtracted(cleaned: string, phrase: string): boolean {
  const cleanedLower = cleaned.toLowerCase()
  const core = phrase.replace(/^an?\s+/i, '').toLowerCase()
  if (!core) return false
  if (cleanedLower === core) return true
  const cleanedWords = cleanedLower.split(/\s+/).filter(Boolean)
  const coreWords = core.split(/\s+/).filter(Boolean)
  if (cleanedWords.length > coreWords.length + 1) return false
  return cleanedWords.slice(0, coreWords.length).join(' ') === core
}

function sentenceCasePreserve(text: string): string {
  const t = stripTrailingPunct(text)
  if (!t) return t
  if (/^(?:AC|HVAC)\b/i.test(t)) {
    return t.replace(/^(ac|hvac)\b/i, (m) => m.toUpperCase())
  }
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Shared issue wording for titles and confirmation/summary lines.
 * Strips greetings/hedging, prefers a classified noun phrase, and never
 * truncates mid-word on fallback.
 */
export function generateIssueSummary(
  rawText: string,
  options: GenerateIssueSummaryOptions,
): string {
  const format = options.format
  const maxChars = options.maxChars ?? DEFAULT_TITLE_CHARS
  const maxWords = options.maxWords ?? DEFAULT_SUMMARY_WORDS
  const category = options.category ?? null

  // Prefer the opening ask — ignore appended Tenant update / labeled intake lines.
  const parts = parseIntakeDescriptionParts(rawText ?? '')
  const raw = (
    parts.openingMessage ||
    parts.tenantUpdates.join(' ') ||
    (rawText ?? '')
  )
    .trim()
    .replace(/\s+/g, ' ')
  if (!raw) {
    const extracted = extractIssueNounPhrase('', category)
    return format === 'title'
      ? formatAsTitle(extracted.phrase, '', maxChars, false)
      : formatAsSummary(extracted.phrase, '', maxWords, extracted.confidence, false)
  }

  const cleaned = stripTenantMessageFiller(raw) || raw
  const extracted = extractIssueNounPhrase(raw, category)
  // Keep short, already-good statements ("No hot water") without rewriting.
  // Prefer high-confidence extraction when the cleaned text is longer / rambling.
  const passThrough =
    isConciseIssueStatement(raw) &&
    (extracted.confidence === 'low' ||
      alreadyMatchesExtracted(cleaned, extracted.phrase))

  if (format === 'title') {
    if (passThrough) {
      return truncateAtWordBoundary(sentenceCasePreserve(cleaned), maxChars)
    }
    return formatAsTitle(extracted.phrase, cleaned, maxChars, false)
  }
  return formatAsSummary(
    extracted.phrase,
    cleaned,
    maxWords,
    extracted.confidence,
    passThrough,
  )
}
