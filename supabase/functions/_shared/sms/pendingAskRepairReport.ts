/**
 * A pending short-answer question must not swallow a fresh repair report.
 * Yield to the normal contextual workflow; this does not create/submit a job
 * or change the stored question. Pronoun-only updates and photos stay with it.
 */
import { matchEmergencyNet } from "../../../../shared/maintenance/deterministicRules.ts"

export function shouldYieldPendingAskToRepair(body: string): boolean {
  const text = body.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim()
  if (matchEmergencyNet(text)) return true
  const separate = /\b(?:new|separate|different|another)\s+(?:(?:qa|separate)\s+)*(?:repair|issue|problem|request)\b/i.test(text)
  // Existing-work updates are still replies to the team's question unless the
  // resident explicitly says this is another problem.
  if (!separate && /\b(?:still|same (?:issue|problem|leak)|that repair)\b/i.test(text)) return false
  const report = text.replace(/\b(?:not|isn't|is not|no longer|without)\s+(?:leaking|dripping|overflowing|clogged|broken|damaged)\b/gi, "")
  const failure = /\b(?:broken|damaged|leaking|dripping|overflowing|clogged|stopped working|not working|isn't working|won't (?:turn|start|cool|heat|close|open|lock|shut)|off (?:its |the )?track|loose (?:hinge|handle)|drains? slowly|no (?:heat|hot water|water pressure))\b/i.test(report)
  if (!failure) return false
  // Require a named fixture/system, not "it's broken" as an answer about an
  // existing repair. Mentioning a fixture alone can be incidental visit wording.
  return /\b(?:sink|toilet|drain|tub|bathtub|shower|faucet|pipe|ceiling|light|outlet|switch|heater|heat|water|ac|air conditioner|furnace|fridge|refrigerator|stove|oven|dishwasher|washer|dryer|door|window|lock|roof)\b/i.test(text)
}
