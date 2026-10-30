/**
 * Daily-priorities intent detector — no DB / presentation imports (cycle-safe).
 */

/**
 * Broad "what should I handle today?" family — Ask Ulo cross-system briefing,
 * not a single work-order ranking path.
 */
export function isDailyPrioritiesQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  // Explicit property / building ranking stays on comparison path.
  if (/\bwhich\s+(?:propert(?:y|ies)|buildings?|communities)\b/i.test(q)) {
    return false
  }
  // Named entity investigation stays narrow.
  if (/\b(?:work\s*order|ticket|WO-)\s*[#:]?\s*[A-Z0-9-]+\b/i.test(q)) {
    return false
  }
  if (/\bunit\s+\d+/i.test(q) && /\b(status|why|resolved|waiting)\b/i.test(q)) {
    return false
  }
  // Longer-horizon strategic briefings stay on existing executive path.
  if (
    /\bover\s+the\s+next\s+\d+\s+days\b/i.test(q) ||
    /\bnext\s+30\s+days\b/i.test(q) ||
    /\bthis\s+month\b/i.test(q) ||
    /\bthis\s+week\b/i.test(q)
  ) {
    return false
  }

  return (
    /\b(?:what|which)\s+(?:open\s+)?(?:repairs?|jobs?|work\s*orders?)\s+(?:need|needs|require)\s+(?:my\s+)?attention\b/i.test(q) ||
    /\bwhat\s+should\s+i\s+prioriti[sz]e(?:\s+today|\s+now|\s+right\s+now)?\b/i.test(q) ||
    /\bwhat\s+should\s+i\s+do(?:\s+today|\s+now|\s+right\s+now)?\b/i.test(q) ||
    /\bwhat\s+should\s+i\s+focus\s+on(?:\s+today|\s+now|\s+right\s+now)?\b/i.test(q) ||
    /\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:most\s+)?urgent\b/i.test(q) ||
    /\banything\s+i\s+need\s+to\s+handle\b/i.test(q) ||
    /\banything\s+(?:i\s+)?(?:need\s+to|to)\s+(?:do|handle|act\s+on)\b/i.test(q) ||
    /\bwhat\s+needs\s+(?:my\s+)?attention(?:\s+today)?\b/i.test(q) ||
    /\bneeds?\s+(?:my\s+)?attention\s+today\b/i.test(q) ||
    /\brank\s+today'?s\s+priorities\b/i.test(q) ||
    /\btoday'?s\s+priorities\b/i.test(q) ||
    /\bshow\s+me\s+everything\s+that\s+needs\s+my\s+attention\s+today\b/i.test(q) ||
    /\bwhere\s+(?:should|would)\s+i\s+start\b/i.test(q)
  )
}
