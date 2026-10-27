/**
 * Tenant confirmation sentences. The problem and the confirmed place stay
 * in the resident's words. A place that does not answer the question we asked
 * stays unresolved instead of being guessed.
 */
import { generateIssueSummary } from "./generateIssueSummary.ts"

export type LocationReading = {
  /** Most specific place supported by the question and the answer. */
  location: string | null
  /** Short follow-up when the answer does not name a place we can use. */
  clarification: string | null
}

const VAGUE_ANSWER =
  /^(?:yes|y|no|n|ok|okay|that one|this one|the other(?: one)?|over there|somewhere|here|there|not sure|unsure|idk|i don't know|i dont know|both|all of them|another one)$/i

const BATHROOM_QUALIFIER: Record<string, string> = {
  bedroom: "bedroom bathroom",
  "bed room": "bedroom bathroom",
  master: "master bathroom",
  primary: "primary bathroom",
  main: "main bathroom",
  guest: "guest bathroom",
  hall: "hall bathroom",
  hallway: "hall bathroom",
  upstairs: "upstairs bathroom",
  downstairs: "downstairs bathroom",
  basement: "basement bathroom",
  attic: "attic bathroom",
  powder: "powder room",
  half: "half bathroom",
  ensuite: "ensuite bathroom",
  "en-suite": "ensuite bathroom",
}

const BEDROOM_QUALIFIER: Record<string, string> = {
  master: "master bedroom",
  primary: "primary bedroom",
  guest: "guest bedroom",
  upstairs: "upstairs bedroom",
  downstairs: "downstairs bedroom",
  kids: "kids bedroom",
  front: "front bedroom",
  back: "back bedroom",
}

export function recoverLocationQuestion(
  messages: { direction?: string | null; body?: string | null }[],
): string | null {
  let found: string | null = null
  for (const message of messages) {
    if ((message.direction ?? "").toLowerCase() !== "outbound") continue
    const body = (message.body ?? "").trim()
    if (/^(?:which|where)\b/i.test(body) &&
      /\b(?:bathroom|bedroom|sink|faucet|window|door|light|outside|room|floor|home)\b/i.test(body)
    ) {
      found = body
    }
  }
  return found
}

function cleanAnswer(answer: string | null | undefined): string {
  return (answer ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:it is|it's|its|in|at|by|the|my|our)\s+/i, "")
    .trim()
}

export function interpretConfirmedLocation(input: {
  problem?: string | null
  answer?: string | null
  question?: string | null
}): LocationReading {
  const problem = (input.problem ?? "").replace(/\s+/g, " ").trim()
  const question = (input.question ?? "").trim()
  const answer = cleanAnswer(input.answer)
  if (!answer || VAGUE_ANSWER.test(answer)) {
    if (/\bwhich bathroom\b/i.test(question)) {
      return {
        location: null,
        clarification:
          "Which bathroom did you mean? You can say the bedroom bathroom, the hall bathroom, or another one.",
      }
    }
    if (question && /^(?:which|where)\b/i.test(question)) {
      return {
        location: null,
        clarification: question,
      }
    }
    return { location: null, clarification: null }
  }

  if (/\bwhich bathroom\b/i.test(question)) {
    if (/^(?:bath(?:room)?)$/i.test(answer)) {
      return {
        location: null,
        clarification:
          "Which bathroom did you mean? You can say the bedroom bathroom, the hall bathroom, or another one.",
      }
    }
    if (/\bbath(?:room)?\b/i.test(answer)) return { location: answer.toLowerCase(), clarification: null }
    const qualified = BATHROOM_QUALIFIER[answer.toLowerCase()]
    if (qualified) return { location: qualified, clarification: null }
    return {
      location: null,
      clarification:
        "Which bathroom did you mean? You can say the bedroom bathroom, the hall bathroom, or another one.",
    }
  }

  if (/\bwhich bedroom\b/i.test(question)) {
    if (/\bbed\s?room\b/i.test(answer)) return { location: answer.toLowerCase(), clarification: null }
    const qualified = BEDROOM_QUALIFIER[answer.toLowerCase()]
    if (qualified) return { location: qualified, clarification: null }
    return {
      location: null,
      clarification: "Which bedroom did you mean?",
    }
  }

  if (/\bwhich (sink|faucet|window|door|light)\b/i.test(question)) {
    const noun = question.match(/\bwhich (sink|faucet|window|door|light)\b/i)?.[1]?.toLowerCase() ?? "one"
    if (new RegExp(`\\b${noun}\\b`, "i").test(answer)) {
      return { location: answer.toLowerCase(), clarification: null }
    }
    if (/^[a-z][a-z\s-]{0,30}$/i.test(answer)) {
      return { location: `${answer.toLowerCase()} ${noun}`, clarification: null }
    }
    return { location: null, clarification: question }
  }

  if (/\bwhere outside\b/i.test(question)) {
    if (VAGUE_ANSWER.test(answer) || /^outside$/i.test(answer)) {
      return { location: null, clarification: "Where outside is this happening?" }
    }
    return { location: answer.toLowerCase(), clarification: null }
  }

  if (
    /\bbathroom\b/i.test(problem) &&
    /^bed\s?room$/i.test(answer) &&
    !question
  ) {
    return {
      location: null,
      clarification: "Did you mean the bathroom in the bedroom?",
    }
  }

  return { location: answer.toLowerCase(), clarification: null }
}

function ensureSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "")
  if (!trimmed) return ""
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return `${cased}.`
}

function openingProblem(text: string): string {
  const first = text.split(/\n|Tenant update:/i)[0] ?? ""
  return first.replace(/\s+/g, " ").trim()
}

function isDirectProblem(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 16) return false
  return !/\b(?:hi|hello|hey|thank|thanks|trying to see|wondering|i hope)\b/i.test(text)
}

/** One sentence naming the problem and, when known, the confirmed place. */
export function problemSentence(problem: string, location: string | null): string {
  const opening = openingProblem(problem)
  if (!isDirectProblem(opening)) {
    const phrase = generateIssueSummary(opening, { format: "summary", maxWords: 18 })
      .replace(/^an?\s+/i, "")
    return ensureSentence(phrase || opening)
  }
  const place = location?.replace(/\s+/g, " ").trim().toLowerCase() || null
  if (/\b(?:smell(?:s)?\s+(?:of\s+)?gas|gas\s+(?:smell|leak)|i smell gas)\b/i.test(opening)) {
    if (place && !opening.toLowerCase().includes(place)) {
      return `There is a gas smell in the ${place}.`
    }
    const named = opening.match(/\bin the ([a-z0-9][a-z0-9\s-]{1,30})$/i)?.[1]
    return named
      ? `There is a gas smell in the ${named.toLowerCase()}.`
      : "There is a gas smell."
  }

  const fixture = opening.match(
    /^(?:the|my|our|there(?:'s| is) an?)\s+(?:([a-z]+)\s+)?(light|sink|faucet|toilet|window|door|outlet|fan|shower)\b\s*(.*)$/i,
  )
  if (fixture) {
    const broad = fixture[1]?.toLowerCase()
    const noun = fixture[2].toLowerCase()
    let rest = fixture[3].replace(/[.!?]+$/g, "").trim()
    if (/^broke$/i.test(rest)) rest = "is broken"
    if (!rest) rest = "needs repair"
    if (place && broad === "bathroom" && noun === "light" && place.includes("bathroom") && place !== "bathroom") {
      return `The light in the ${place} ${rest}.`
    }
    if (place && !opening.toLowerCase().includes(place)) {
      if (!place.includes(noun)) return `The ${place} ${noun} ${rest}.`
      return `The ${noun} in the ${place} ${rest}.`
    }
    if (broad && broad !== noun) return `The ${broad} ${noun} ${rest}.`
    return `The ${noun} ${rest}.`
  }

  if (/\bthere(?:'s| is) a leak outside\b/i.test(opening) && place && !/^outside$/.test(place)) {
    return `There is a leak on the ${place}.`
  }
  if (place && !opening.toLowerCase().includes(place)) {
    const base = ensureSentence(opening).replace(/\.$/, "")
    return `${base} It is in the ${place}.`
  }
  return ensureSentence(opening || "Maintenance issue")
}

export function scopeSentence(value: string | null | undefined): string | null {
  const lower = (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  if (!lower) return null
  if (/only in that room|just that room|only that room/.test(lower)) {
    return "The issue is limited to that room."
  }
  if (/other parts|rest of the (?:home|house)|whole (?:home|house)|everywhere/.test(lower)) {
    return "It is also happening in other parts of the home."
  }
  return null
}

export function entrySentence(value: string | null | undefined): string | null {
  const lower = (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  if (!lower) return null
  if (/^(?:y|yes)\b/.test(lower)) return "Staff or a vendor may enter if no one is home."
  if (/^(?:n|no)\b/.test(lower)) return "Do not enter if no one is home."
  if (lower === "not_sure" || /^(?:not sure|unsure)\b/.test(lower)) {
    return "It isn't confirmed whether someone can enter if no one is home."
  }
  return null
}
