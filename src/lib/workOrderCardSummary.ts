import { looksLikeStatusInquiry } from '@/lib/smartIntelligence/helpers'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { generateIssueSummary } from '@shared/maintenance/generateIssueSummary.ts'
import { extractStructuredIssueDetails } from '@shared/maintenance/structuredIssueDetails.ts'
import {
  containsGreetingOrPleasantry,
  stripTenantMessageFiller,
} from '@shared/maintenance/issueNounPhrase.ts'
import { homeCheckWorkOrderTitle } from '@shared/homeCheck'

const FILLER = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'come',
  'could',
  'fix',
  'good',
  'got',
  'have',
  'hello',
  'hey',
  'hi',
  'is',
  'it',
  'just',
  'like',
  'morning',
  'afternoon',
  'evening',
  'my',
  'of',
  'our',
  'please',
  'really',
  'someone',
  'the',
  'there',
  'to',
  'um',
  'very',
  'we',
  'you',
])

const SMALL_TITLE_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'is', 'no', 'not', 'of', 'on', 'or', 'the', 'to'])

const ACRONYMS: Record<string, string> = {
  ac: 'AC',
  hvac: 'HVAC',
}

type PhraseRule = {
  test: RegExp
  phrase: string
}

const PHRASE_RULES: PhraseRule[] = [
  { test: /\bno hot water\b/i, phrase: 'No hot water' },
  { test: /\b(ac|a\/c|air conditioner).{0,28}(not cool|won'?t cool|isn'?t cool|blowing warm|warm air)/i, phrase: 'AC not cooling' },
  { test: /\bbaseboard\s+heat(?:er|ing)?.{0,40}(leak|leaking|drip|rust)/i, phrase: 'Baseboard heater leak' },
  { test: /\b(leak|leaking|drip|rust).{0,40}baseboard\s+heat(?:er|ing)?/i, phrase: 'Baseboard heater leak' },
  { test: /\b(heat|heater|furnace|radiator).{0,24}(not work|no heat|won'?t|broken|cold)/i, phrase: 'Heat not working' },
  { test: /\boutlet.{0,24}spark/i, phrase: 'Outlet is sparking' },
  { test: /\b(power|electricity).{0,16}(out|off|down)/i, phrase: 'Power is out' },
  { test: /\btoilet.{0,28}(overflow|clog|backup|won'?t flush|not flush)/i, phrase: 'Toilet not flushing' },
  { test: /\bkitchen.{0,20}sink.{0,20}leak/i, phrase: 'Kitchen sink leaking' },
  { test: /\b(bath(?:room)?).{0,20}sink.{0,20}leak/i, phrase: 'Bathroom sink leaking' },
  { test: /\bsink.{0,20}leak/i, phrase: 'Sink is leaking' },
  { test: /\bdishwasher.{0,16}leak/i, phrase: 'Dishwasher is leaking' },
  { test: /\b(fridge|refrigerator).{0,24}(not cool|warm|broken)/i, phrase: 'Fridge not cooling' },
  { test: /\b(washer|washing machine).{0,24}(not drain|leak|broken)/i, phrase: 'Washer not draining' },
  { test: /\bdryer.{0,16}(not heat|broken)/i, phrase: 'Dryer not heating' },
  {
    test: /\bdryer.{0,28}(caught\s+(?:on\s+)?fire|catch(?:ing)?\s+fire|on\s+fire|fire)/i,
    phrase: 'Dryer caught fire',
  },
  {
    test: /\b(caught\s+(?:on\s+)?fire|catch(?:ing)?\s+fire|on\s+fire)\b/i,
    phrase: 'Fire hazard reported',
  },
  { test: /\b(oven|stove).{0,16}(not heat|broken)/i, phrase: 'Oven not heating' },
  { test: /\bdrain.{0,16}clog|clogged drain/i, phrase: 'Drain is clogged' },
  { test: /\b(lock|deadbolt|door).{0,16}(broken|won'?t|jam|stuck)/i, phrase: 'Door lock broken' },
  { test: /\b(ceiling|roof).{0,16}leak|leak.{0,12}(ceiling|roof)/i, phrase: 'Ceiling water leak' },
  { test: /\b(pest|roach|mice|mouse|bed ?bug|ant|exterminat)/i, phrase: 'Pest issue reported' },
  { test: /\bwater.{0,16}(leak|flood|coming in)/i, phrase: 'Water leak reported' },
]

function firstLine(description: string | null | undefined): string {
  return (description ?? '').trim().split('\n')[0]?.trim() ?? ''
}

function titleCasePhrase(words: string[]): string {
  return words.map((raw, index) => {
    const lower = raw.toLowerCase()
    if (ACRONYMS[lower]) return ACRONYMS[lower]
    if (index > 0 && index < words.length - 1 && SMALL_TITLE_WORDS.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

function contentWords(text: string): string[] {
  return text
    .replace(/[^a-zA-Z0-9'/\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean)
    .filter((w) => !FILLER.has(w.toLowerCase()))
}

function padToThreeWords(words: string[], tradeLabel: string | null): string[] {
  const clipped = words.slice(0, 5)
  if (clipped.length >= 3) return clipped.slice(0, 5)
  const tradeWord = tradeLabel?.split(/\s+/)[0] ?? null
  if (clipped.length === 0) {
    return tradeWord ? [tradeWord, 'repair', 'needed'] : ['Maintenance', 'repair', 'needed']
  }
  if (clipped.length === 1) {
    if (tradeWord && clipped[0].toLowerCase() !== tradeWord.toLowerCase()) {
      return [tradeWord, clipped[0], 'repair']
    }
    return [clipped[0], 'repair', 'needed']
  }
  if (tradeWord && !clipped.some((w) => w.toLowerCase() === tradeWord.toLowerCase())) {
    return [tradeWord, ...clipped].slice(0, 5)
  }
  return [...clipped, 'repair']
}

function phraseWordCount(phrase: string): number {
  return phrase.trim().split(/\s+/).filter(Boolean).length
}

function usableHeadline(headline: string | null | undefined): string | null {
  const raw = (headline ?? '').trim()
  if (!raw) return null
  if (containsGreetingOrPleasantry(raw)) return null
  if (looksLikeStatusInquiry(raw)) return null
  const words = phraseWordCount(raw)
  if (words < 2 || words > 8) return null
  // Prefer sentence/title case already on the ticket; light normalize.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export type WorkOrderCardBlurbOptions = {
  issueHeadline?: string | null
}

/**
 * 3–5 word landlord-facing blurb for an Active Tasks work-order card.
 * Prefers a stored issue_headline, then shared generateIssueSummary, then
 * phrase rules — never a greeting-led first line or bare trade label when
 * the resident described a specific problem.
 */
export function summarizeWorkOrderCardBlurb(
  description: string | null | undefined,
  issueCategory: string | null | undefined,
  options?: WorkOrderCardBlurbOptions,
): string {
  const homeCheckTitle = homeCheckWorkOrderTitle(description, issueCategory)
  if (homeCheckTitle) return homeCheckTitle

  const fromHeadline = usableHeadline(options?.issueHeadline)
  if (fromHeadline) return fromHeadline

  const trade = formatVendorTradeLabel(issueCategory, { emptyLabel: '' }).trim() || null
  const full = (description ?? '').trim()
  const line = firstLine(description)
  const cleanedLine = stripTenantMessageFiller(line)
  const usable = cleanedLine && !looksLikeStatusInquiry(cleanedLine) ? cleanedLine : ''
  const phraseHay = full || usable

  if (phraseHay) {
    for (const rule of PHRASE_RULES) {
      if (rule.test.test(phraseHay) && phraseWordCount(rule.phrase) >= 3 && phraseWordCount(rule.phrase) <= 5) {
        return rule.phrase
      }
    }

    const shared = generateIssueSummary(phraseHay, {
      format: 'title',
      category: issueCategory,
      maxChars: 50,
    }).trim()
    if (
      shared &&
      !/^maintenance issue$/i.test(shared) &&
      !/^(?:a |an )?(plumbing|hvac|electrical|appliance) issue$/i.test(shared)
    ) {
      return shared
    }

    if (usable) {
      const words = padToThreeWords(contentWords(usable), trade)
      return titleCasePhrase(words)
    }
  }

  return titleCasePhrase(padToThreeWords([], trade))
}

/**
 * Short secondary line for Active Tasks: location + a compact reported detail.
 */
export function summarizeWorkOrderCardDetail(
  description: string | null | undefined,
  issueCategory: string | null | undefined,
): string | null {
  const homeCheckTitle = homeCheckWorkOrderTitle(description, issueCategory)
  if (homeCheckTitle) return null

  const structured = extractStructuredIssueDetails(description ?? '', {
    category: issueCategory,
    format: 'title',
  })
  const bits: string[] = []
  if (structured.locationDetail) bits.push(structured.locationDetail)
  if (structured.servesFloor) bits.push(`Serves ${structured.servesFloor}`)
  const reported = structured.reportedDetail
  if (reported) {
    // Keep the card secondary line short — first sentence.
    const compact = reported
      .split(/(?<=\.)\s+/)[0]!
      .replace(/\s+/g, ' ')
      .trim()
    const words = compact.split(/\s+/).filter(Boolean)
    bits.push(words.length > 16 ? `${words.slice(0, 16).join(' ')}…` : compact)
  }
  if (bits.length === 0) return null
  return bits.join(' · ')
}
