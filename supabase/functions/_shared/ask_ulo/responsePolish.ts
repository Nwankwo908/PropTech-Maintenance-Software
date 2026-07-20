/**
 * Ask Ulo response polish — never show UI-clipped text or retrieval mechanics.
 * Applied as a synthesis guide + deterministic post-pass on landlord-facing answers.
 */

import {
  humanizeOperationalProse,
  OPERATIONAL_LANGUAGE_GUIDE,
} from "./operationalLanguage.ts"

/** Model instructions: normalize language before the landlord sees it. */
export const RESPONSE_POLISH_GUIDE = `
## Response polish (never skip)

${OPERATIONAL_LANGUAGE_GUIDE}

### Never expose truncated or UI-clipped text
Source fields are often shortened for tables/cards. Never copy abbreviations such as:
roste, ele, maint, appr, exp resp, req hist, HVAC ven, assign rev.

Either use the full underlying value, or rewrite the sentence in natural English.

Bad → Good:
- "No plumbing vendor available on roste." → "No plumbing vendor is currently available on your roster."
- "Assigned electrician declined — no other ele." → "The assigned electrician declined the job, and no other electrician is currently available."
- "expected response time expired" / "exp resp" → "The vendor response deadline has passed."

### Grammar pass (before send)
Rewrite until the answer sounds like a human property manager wrote it:
- truncated / misspelled words
- incomplete sentences
- duplicated words
- enum values, snake_case, camelCase, database field names, internal codes
- clipped punctuation

### Insights only — never retrieval results
Evidence is for you; the landlord only sees insights.

Never say:
- I found N matching records / related requests
- in scope / matching entities / normalized results
- query returned / operational evidence / retrieved records

Answer, in this order:
1. What matters most?
2. Why does it matter?
3. What should the landlord do next?

Support with relevant facts — never with backend retrieval mechanics.
`.trim()

/** Common UI-truncation fragments → readable repairs. */
const TRUNCATION_REWRITES: Array<[RegExp, string]> = [
  [/\bon\s+roste\b/gi, "on your roster"],
  [/\bleft\s+on\s+roste\b/gi, "left on your roster"],
  [/\broster\s+for\s+reassignment\b/gi, "roster to reassign"],
  [/\bno\s+other\s+ele(?:ctr)?\b/gi, "no other electrician"],
  [/\bno\s+hvac\s+ven(?:dor)?\b/gi, "no HVAC vendor"],
  [/\bhvac\s+ven\b/gi, "HVAC vendor"],
  [/\bassign\s+rev\b/gi, "assignment review"],
  [/\bexp(?:ected)?\s*resp(?:onse)?\b/gi, "vendor response deadline"],
  [/\breq(?:uest)?\s*hist(?:ory)?\b/gi, "request history"],
  [/\bappr(?:oval)?\b(?!\w)/gi, "approval"],
  // Standalone clipped "maint" only (not inside "maintenance")
  [/\bmaint\b(?!enance)/gi, "maintenance"],
  [/\bele\b(?!ctric|vator|ment)/gi, "electrician"],
]

/** Awkward deadline phrasing our own rewrites sometimes create. */
const DEADLINE_REWRITES: Array<[RegExp, string]> = [
  [
    /\bexpected\s+response\s+time\s*\/\s*due\s+time\s+already\s+passed\b/gi,
    "vendor response deadline has passed",
  ],
  [
    /\bexpected\s+response\s+time(?:s)?\s+(?:already\s+)?(?:expired|passed|missed)\b/gi,
    "vendor response deadline has passed",
  ],
  [
    /\b(?:the\s+)?expected\s+response\s+time\s+has\s+(?:already\s+)?(?:expired|passed)\b/gi,
    "the vendor response deadline has passed",
  ],
  [/\bSLA\s*\/\s*due\s+time\s+already\s+passed\b/gi, "vendor response deadline has passed"],
  [/\bSLA[- ]?overdue\b/gi, "past the vendor response deadline"],
  [/\bThe\s+SLA\s+has\s+already\s+expired\b/gi, "The vendor response deadline has passed"],
]

/** Strip / rewrite retrieval-mechanics language into insight voice. */
const RETRIEVAL_LEAK_REWRITES: Array<[RegExp, string]> = [
  [
    /\bI\s+(?:also\s+)?found\s+\*{0,2}\d+\*{0,2}\s+related\s+requests?\s+in\s+scope\.?/gi,
    "There's related work nearby that may share the same cause.",
  ],
  [
    /\bI\s+found\s+(?:\*{0,2}\d+\*{0,2}|one|several)\s+matching\b/gi,
    "There's",
  ],
  [
    /\bI\s+found\s+(?:\*{0,2}\d+\*{0,2}|one|several)\s+active\b/gi,
    "There's an active",
  ],
  [/\bI\s+found\s+\d+\s+matching\s+records?\b/gi, "From the live maintenance picture"],
  [/\b\d+\s+matching\s+records?\b/gi, "these open requests"],
  [/\b\d+\s+related\s+requests?\b/gi, "related open requests"],
  [/\bin\s+scope\b/gi, "across your portfolio"],
  [/\bmatching\s+entities\b/gi, "related requests"],
  [/\bnormalized\s+results?\b/gi, "what stands out"],
  [/\bquery\s+returned\b/gi, "the current picture shows"],
  [/\boperational\s+evidence\b/gi, "what's happening on site"],
  [/\bretrieved\s+records?\b/gi, "current maintenance activity"],
  [/(^|\n)###\s*What I found\b/gi, "$1### What's going on"],
  [/\bI'?m\s+listing\b/gi, ""],
  [/\bI\s+searched\b/gi, ""],
  [/\bBased\s+on\s+the\s+available\b/gi, ""],
]

function applyPairs(raw: string, pairs: Array<[RegExp, string]>): string {
  let s = raw
  for (const [re, to] of pairs) {
    s = s.replace(re, to)
  }
  return s
}

/**
 * Deterministic landlord-facing polish after synthesis / packet markdown.
 * Idempotent enough to run on every answer.
 */
export function polishAskUloProse(raw: string): string {
  if (!raw.trim()) return raw
  let s = raw
  s = applyPairs(s, TRUNCATION_REWRITES)
  s = applyPairs(s, DEADLINE_REWRITES)
  s = applyPairs(s, RETRIEVAL_LEAK_REWRITES)
  s = humanizeOperationalProse(s)

  // snake_case / camelCase field leaks (conservative: isolated tokens)
  s = s.replace(/\b([a-z]+_[a-z0-9_]+)\b/g, (_, tok: string) => {
    if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(tok)) {
      return tok.replace(/_/g, " ")
    }
    return tok
  })

  // Collapse accidental double spaces (keep newlines)
  s = s.replace(/[^\S\n]{2,}/g, " ").replace(/[ \t]+\n/g, "\n")
  // Fix "There's an active 3 HVAC" style after number replace mishaps — prefer leave counts in prose bullets only.
  s = s.replace(/\bThere's an active (\d+)\s+/gi, "There are $1 active ")
  s = s.replace(/\bThere's (\d+)\s+/gi, "There are $1 ")
  return s.trim()
}

/** Quick detector for QC / tests. */
export function looksLikeClippedOpsText(text: string): boolean {
  return (
    /\b(roste|exp\s*resp|req\s*hist|assign\s+rev)\b/i.test(text) ||
    /\bno\s+other\s+ele\b/i.test(text) ||
    /\bhvac\s+ven\b/i.test(text) ||
    /\bmaint\b(?!enance)/i.test(text)
  )
}

export function looksLikeRetrievalMechanicsLeak(text: string): boolean {
  return (
    /\bI\s+found\s+\d+\s+matching\b/i.test(text) ||
    /\bI'?m\s+listing\b/i.test(text) ||
    /\bI\s+searched\b/i.test(text) ||
    /\bBased\s+on\b/i.test(text) ||
    /\bin\s+scope\b/i.test(text) ||
    /\boperational\s+evidence\b/i.test(text) ||
    /\bretrieved\s+records?\b/i.test(text) ||
    /\bnormalized\s+results?\b/i.test(text) ||
    /\bquery\s+returned\b/i.test(text) ||
    /\bmatching\s+entities\b/i.test(text)
  )
}
