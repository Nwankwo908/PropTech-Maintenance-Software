/**
 * When Active Tasks work-order Overview / next-step drafts still read like
 * system stubs, gpt-6-luna may rewrite them (OpenAI Docs writing style).
 *
 * Prompting follows OpenAI Docs (GPT-6 family / Luna):
 * - Specify writing style explicitly (plain language, active voice, no lists)
 * - State the main point early; keep the task focused for Luna
 * - Put few-shot examples in the user message
 * https://developers.openai.com/api/docs/guides/latest-model
 */

/** True when the deterministic draft still sounds stiff or grammatically awkward. */
export function needsWorkOrderRailLineRecovery(draft: string): boolean {
  const text = draft.trim()
  if (!text) return false

  // Vendor names ending in By / And / Of before “never accepted”.
  if (/\b(by|and|of)\s+never accepted\b/i.test(text)) return true
  if (/\bnever accepted\b/i.test(text)) return true
  if (/^no acceptance from\b/i.test(text)) return true
  if (/\bwaiting on confirmation\b/i.test(text)) return true
  if (/\bvendor unresponsive\b/i.test(text)) return true
  if (/\bulo is coordinating\b/i.test(text)) return true
  if (/\bcurrent stage:\b/i.test(text)) return true
  return false
}

/**
 * OpenAI Docs — personality / writing style for one landlord rail sentence.
 * Style in system; few-shots + draft in user (prompt-engineering).
 */
export const WORK_ORDER_RAIL_POLISH_SYSTEM =
  'You rewrite one short status line for a landlord viewing a maintenance work order in Ulo. ' +
  'Use plain, simple language: familiar words, concrete details, and precise verbs. ' +
  'Prefer active voice and direct statements. State the main point clearly and early. ' +
  'One or two short sentences only — no lists, no markdown, no bullet points, no quotes around the whole line. ' +
  'Sound like a thoughtful property manager, not a system log. ' +
  'Keep every person name, vendor business name, day/time window, and dollar amount from the draft exactly. ' +
  'Do not invent people, places, times, or outcomes. ' +
  'When a vendor business name ends with By, And, or Of, do not make that word the grammatical subject of “never accepted” — rephrase so the sentence stays clear. ' +
  'Never use: workflow, SLA, graph event, pending_accept, status enum, Needs Your Attention. ' +
  'Return only the rewritten line.'

export const WORK_ORDER_RAIL_POLISH_FEW_SHOTS = `Examples (rewrite the draft into a short, friendly landlord line):
Draft: Handyman Services By Michael never accepted. Vendor unresponsive — needs a new vendor choice.
Rewritten: Handyman Services By Michael still hasn't accepted — you'll need to pick another vendor.
Draft: No acceptance from Handyman Services By Michael. Vendor unresponsive — needs a new vendor choice.
Rewritten: Still no acceptance from Handyman Services By Michael — pick another vendor when you're ready.
Draft: Ecosafe proposed Wed 2–4pm. Waiting on confirmation.
Rewritten: Waiting for the resident to confirm Ecosafe for Wed 2–4pm.
Draft: Waiting on Alex to confirm Flex Plumbing for Mon 2–4pm (asked 2h ago).
Rewritten: Waiting on Alex to confirm Flex Plumbing for Mon 2–4pm (asked 2h ago).
Draft: Flex Plumbing accepted. Ulo is coordinating a visit time with the resident.
Rewritten: Flex Plumbing accepted — we're lining up a visit time with the resident.`
