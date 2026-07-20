/** Topic-aware rotating status lines while Ask Ulo researches an answer. */

export type AskUloLoadingTopic =
  | 'market'
  | 'maintenance'
  | 'lease'
  | 'health'
  | 'price_history'
  | 'vendor'
  | 'legal'
  | 'general'

const TOPIC_MESSAGES: Record<AskUloLoadingTopic, string[]> = {
  market: [
    'Analyzing the local rental market…',
    'Finding comparable properties…',
    'Reviewing rent trends…',
    'Reviewing neighborhood demand…',
  ],
  maintenance: [
    'Reviewing maintenance history…',
    'Checking vendor availability…',
    'Finding recurring issues…',
  ],
  lease: [
    'Reviewing lease details…',
    'Checking important dates…',
    'Checking local regulations…',
  ],
  health: [
    'Calculating property health…',
    'Reviewing portfolio performance…',
  ],
  price_history: [
    'Looking up historical property values…',
    'Reviewing public property records…',
    'Analyzing valuation history…',
  ],
  vendor: [
    'Searching available vendors…',
    'Comparing qualifications…',
    'Searching vendor network…',
  ],
  legal: [
    'Finding applicable laws…',
    'Verifying official sources…',
  ],
  general: [
    'Reviewing your portfolio…',
    'Gathering the right context…',
    'Putting the answer together…',
  ],
}

export function detectAskUloLoadingTopic(prompt: string): AskUloLoadingTopic {
  const q = prompt.toLowerCase()

  if (
    /\b(price history|zestimate|home value|property value|valuation|rent history)\b/.test(q) ||
    /\b(historical|history)\b.*\b(price|value|rent)\b/.test(q)
  ) {
    return 'price_history'
  }
  if (
    /\b(market analysis|comparable|comps?|rental market|rent trend|asking rent|fair market)\b/.test(
      q,
    ) ||
    /\bmarket\b/.test(q)
  ) {
    return 'market'
  }
  if (/\b(vendor|contractor|technician|plumber|electrician|hvac)\b/.test(q)) {
    return 'vendor'
  }
  if (
    /\b(maintenance|work order|repair|ticket|plumbing|leak|hvac|work\s*orders?)\b/.test(q)
  ) {
    return 'maintenance'
  }
  if (/\b(lease|renewal|move[- ]?in|move[- ]?out|tenant|resident agreement)\b/.test(q)) {
    return 'lease'
  }
  if (/\b(property health|portfolio health|health score|portfolio performance)\b/.test(q)) {
    return 'health'
  }
  if (/\b(law|legal|statute|regulation|ordinance|compliance|eviction)\b/.test(q)) {
    return 'legal'
  }
  return 'general'
}

export function askUloLoadingMessages(topic: AskUloLoadingTopic): string[] {
  return TOPIC_MESSAGES[topic]
}

export function askUloLoadingMessagesForPrompt(prompt: string): string[] {
  return askUloLoadingMessages(detectAskUloLoadingTopic(prompt))
}
