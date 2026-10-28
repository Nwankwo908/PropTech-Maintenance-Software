/**
 * Bind one resident reply to the question Ulo asked.
 * A later reply updates only that detail. Ambiguous words are not stored.
 */
import { acceptItemDetailAnswer, itemDetailQuestion } from "./itemDetail.ts"
import { acceptLocationReply } from "./locationClarification.ts"

export type BoundAnswer =
  | { kind: "item_detail"; value: string }
  | { kind: "location"; value: string }
  | { kind: "clarify"; question: string; pendingValue: string }
  | { kind: "unrecognized" }

const ITEM_QUESTION =
  /^(?:Is it a ceiling light|What appears to be leaking|Which appliance|What isn't working with the window|What did you see)\b/i

const LOCATION_QUESTION =
  /\b(?:which (?:hallway|closet|stairs|room|bathroom|bedroom|sink|faucet|window|door|light)|where (?:in the home|outside|are you))\b/i

const PLACE_WORD =
  /\b(?:hallway|hall|kitchen|bathroom|bedroom|upstairs|downstairs|basement|attic|garage|near|room|closet|stairs|stairway)\b/i

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

function isQuestionEcho(answer: string, question: string | null | undefined): boolean {
  const left = clean(answer).toLowerCase().replace(/[.!?]+$/g, "")
  const right = clean(question).toLowerCase().replace(/[.!?]+$/g, "")
  if (!left || !right) return false
  return left === right
}

function looksLikePlacePhrase(answer: string): boolean {
  const text = clean(answer)
  if (/^(?:in|at|on)\s+(?:the\s+)?/i.test(text) && !/\blight\b/i.test(text)) return true
  if (PLACE_WORD.test(text)) return true
  return text.split(/\s+/).length >= 4
}

function isAmbiguousToken(answer: string): boolean {
  return /^(?:ceiling|in the ceiling|the ceiling)$/i.test(clean(answer))
}

function clarifyQuestion(answer: string, problem: string): string {
  if (/\bceiling\b/i.test(answer) && /\b(?:light|fixture)\b/i.test(problem)) {
    return "Did you mean a ceiling light, or that this is happening in the ceiling?"
  }
  if (/\bceiling\b/i.test(answer)) {
    return "Did you mean the ceiling is the item, or that this is happening in the ceiling?"
  }
  return "Did you mean the kind of item, or where it is?"
}

function resolveClarification(
  answer: string,
  pendingValue: string | null | undefined,
  problem: string,
): BoundAnswer {
  const text = clean(answer)
  const pending = clean(pendingValue) || "ceiling"
  if (/^(?:light|the light|ceiling light|the type|light type)$/i.test(text)) {
    return { kind: "item_detail", value: pending.replace(/^(?:in the|the)\s+/i, "") }
  }
  if (/^(?:place|the place|location|the location|in the ceiling|where it is)$/i.test(text)) {
    return { kind: "location", value: pending.replace(/^(?:in the|the)\s+/i, "") }
  }
  if (looksLikePlacePhrase(text)) {
    const place = acceptLocationReply(text)
    if (place) return { kind: "location", value: place }
  }
  const item = acceptItemDetailAnswer(text)
  if (item && !isAmbiguousToken(text) && !looksLikePlacePhrase(text)) {
    return { kind: "item_detail", value: item }
  }
  return {
    kind: "clarify",
    question: clarifyQuestion(pending, problem),
    pendingValue: pending,
  }
}

/** Which field this reply updates. Unrecognized and clarify change nothing. */
export function interpretBoundAnswer(input: {
  answer: string
  question?: string | null
  questionType?: string | null
  problem?: string | null
  itemDetail?: string | null
  lastAnsweredQuestionType?: string | null
  pendingValue?: string | null
}): BoundAnswer {
  const answer = clean(input.answer)
  const problem = clean(input.problem)
  const questionType = clean(input.questionType)
  if (!answer || isQuestionEcho(answer, input.question)) return { kind: "unrecognized" }

  if (questionType === "answer_clarification") {
    return resolveClarification(answer, input.pendingValue, problem)
  }

  const itemQuestionOpen = questionType === "item_detail" || ITEM_QUESTION.test(clean(input.question))
  if (itemQuestionOpen) {
    const value = acceptItemDetailAnswer(answer)
    if (!value) return { kind: "unrecognized" }
    return { kind: "item_detail", value }
  }

  const locationQuestionOpen = questionType === "room_or_area" ||
    questionType === "pest_location" ||
    LOCATION_QUESTION.test(clean(input.question))
  if (locationQuestionOpen) {
    if (
      isAmbiguousToken(answer) &&
      (itemDetailQuestion(problem) || input.itemDetail)
    ) {
      return {
        kind: "clarify",
        question: clarifyQuestion(answer, problem),
        pendingValue: "ceiling",
      }
    }
    if (!looksLikePlacePhrase(answer)) return { kind: "unrecognized" }
    const place = acceptLocationReply(answer)
    if (!place) return { kind: "unrecognized" }
    return { kind: "location", value: place }
  }

  if (PLACE_WORD.test(answer)) {
    const place = acceptLocationReply(answer)
    if (place) return { kind: "location", value: place }
  }

  const itemValue = acceptItemDetailAnswer(answer)
  const itemApplies = Boolean(itemValue) &&
    (Boolean(input.itemDetail) || Boolean(itemDetailQuestion(problem)) ||
      input.lastAnsweredQuestionType === "item_detail")
  const placeApplies = looksLikePlacePhrase(answer) && Boolean(acceptLocationReply(answer))
  const ambiguous = isAmbiguousToken(answer) && itemApplies

  if (ambiguous && placeApplies) {
    return {
      kind: "clarify",
      question: clarifyQuestion(answer, problem),
      pendingValue: itemValue || "ceiling",
    }
  }
  if (ambiguous) {
    if (input.lastAnsweredQuestionType === "item_detail") {
      return { kind: "item_detail", value: itemValue || "ceiling" }
    }
    if (input.lastAnsweredQuestionType === "room_or_area") {
      const place = acceptLocationReply(answer)
      if (place) return { kind: "location", value: place }
    }
    return {
      kind: "clarify",
      question: clarifyQuestion(answer, problem),
      pendingValue: itemValue || "ceiling",
    }
  }
  if (itemApplies && placeApplies) {
    if (input.lastAnsweredQuestionType === "item_detail" && !/^(?:in|at|on)\b/i.test(answer)) {
      return { kind: "item_detail", value: itemValue! }
    }
    if (input.lastAnsweredQuestionType === "room_or_area") {
      return { kind: "location", value: acceptLocationReply(answer)! }
    }
    return {
      kind: "clarify",
      question: clarifyQuestion(answer, problem),
      pendingValue: itemValue!,
    }
  }
  if (itemApplies && itemValue) return { kind: "item_detail", value: itemValue }
  if (placeApplies) {
    const place = acceptLocationReply(answer)
    if (place) return { kind: "location", value: place }
  }
  return { kind: "unrecognized" }
}
