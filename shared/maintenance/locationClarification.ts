import { isGasEmergencyText, resolveUrgencyPolicy } from "./urgencyPolicy.ts"

export type LocationClarification = {
  /** Place specific enough to look for the problem. Null when it is still too broad. */
  location: string | null
  /** Short follow-up. Null when no more location detail is needed. */
  question: string | null
}

const NOT_A_PLACE =
  /^(yes|y|no|nope|nah|ok|okay|skip|none|not sure|unsure|idk|i don't know|i dont know|unknown)$/i

const AMBIGUOUS_ROOM =
  /^(?:bed\s?room|bath(?:room)?|bath)$/i

const SPECIFIC_INTERIOR =
  /\b(?:kitchen|living room|dining room|laundry(?: room)?|garage|basement|attic|office|utility room|hallway|hall|closet|entryway|foyer)\b/i

const SPECIFIC_EXTERIOR =
  /\b(?:front|back|side|rear)\s+(?:porch|yard|door|steps|stairs|entrance|of the (?:house|home|building))\b|\b(?:driveway|sidewalk|roof|gutter|balcony|deck|patio|garage|fence|carport|front porch|back porch)\b/i

const VAGUE_EXTERIOR = /\b(?:outside|outdoors|out back|in the yard|the yard|exterior)\b/i

const FLOOR_ONLY =
  /\b(?:upstairs|downstairs|first floor|second floor|third floor|1st floor|2nd floor|3rd floor|main floor)\b/i

const FIXTURE =
  /\b(sink|faucet|tap|toilet|shower|tub|bathtub|window|outlet|light|lamp|door|stove|oven|fridge|refrigerator|dishwasher|washer|dryer)\b/i

/**
 * A free-text place. Keeps qualifiers such as "upstairs hall bathroom".
 * Yes/no and clock times are not places.
 */
export function acceptLocationReply(answer: string | null | undefined): string | null {
  let text = (answer ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "")
  if (!text || NOT_A_PLACE.test(text)) return null
  if (/^(today|tonight|yesterday|just now|this morning|this afternoon|this evening)$/i.test(text)) {
    return null
  }
  text = text.replace(/^(it is|it's|its)\s+/i, "")
  text = text.replace(/^(in|at|by|near|around|on)\s+(?:the\s+)?/i, "")
  text = text.replace(/^(the|my|our)\s+/i, "")
  text = text.trim()
  if (!text || NOT_A_PLACE.test(text)) return null
  if (text.length > 80 || text.split(/\s+/).length > 12) return null
  if (
    /\b(leak(?:ing)?|broken|isn'?t|won'?t|not working|clogged|dripp(?:ing)?|smell|spark|flood(?:ed|ing)?)\b/i
      .test(text)
  ) {
    return null
  }
  if (/\b(?:is|are|was|were)\b/i.test(text)) return null
  if (
    /^(?:sink|faucet|tap|toilet|shower|tub|bathtub|window|outlet|light|lamp|door|stove|oven|fridge|refrigerator|dishwasher|washer|dryer)$/i
      .test(text)
  ) {
    return null
  }
  return text
}

function countIsOne(count: number | null | undefined): boolean {
  return count === 1
}

function problemAsk(text: string, noun: string): string {
  const lower = text.toLowerCase()
  if (noun === "sink" && /\bleak/.test(lower)) return "Which sink is leaking?"
  if (noun === "sink" && /\bclog/.test(lower)) return "Which sink is clogged?"
  if ((noun === "faucet" || noun === "tap") && /\bdripp/.test(lower)) {
    return "Which faucet is dripping?"
  }
  if (noun === "window" && /\bbroken\b/.test(lower)) return "Which window is broken?"
  if (noun === "light" && /\b(isn'?t working|not working|won'?t turn on|won'?t work|out)\b/.test(lower)) {
    return "Which light isn't working?"
  }
  if (noun === "door") return "Which door is it?"
  return `Which ${noun} is it?`
}

function outsideAsk(text: string): string {
  if (/\bleak/.test(text.toLowerCase())) return "Where outside is the leak?"
  return "Where outside is this happening?"
}

function isWholeHomeSystem(text: string): boolean {
  if (/\b(?:bed\s?room|bath(?:room)?|kitchen|sink|toilet|window|light|door)\b/i.test(text)) {
    return false
  }
  return /\b(?:\bac\b|a\/c|air conditioning|furnace|thermostat|no heat|boiler|central (?:air|heat)|hvac)\b/i
    .test(text)
}

function qualifiedPlace(text: string, room: "bathroom" | "bedroom"): string | null {
  const roomWord = room === "bedroom" ? "bed\\s?room" : "bath(?:room)?"
  const match = text.match(
    new RegExp(
      `\\b((?:master|primary|main|guest|hall|hallway|upstairs|downstairs|front|back|rear|kids'?|children'?s|nursery|powder|half|ensuite|en-suite|only|first[\\s-]?floor|second[\\s-]?floor|third[\\s-]?floor|1st|2nd|3rd|basement|attic|left|right)\\s+){1,3}${roomWord}\\b`,
      "i",
    ),
  )
  return match?.[0]?.replace(/\s+/g, " ").trim().toLowerCase() ?? null
}

/**
 * Decide whether the resident has already named a findable place.
 * A bare bathroom, bedroom, floor, or "outside" still needs a short follow-up.
 * Emergencies do not wait on that follow-up.
 */
export function clarifyIssueLocation(input: {
  text: string
  bedroomCount?: number | null
  bathroomCount?: number | null
}): LocationClarification {
  const text = (input.text ?? "").replace(/\s+/g, " ").trim()
  if (!text) return { location: null, question: null }

  const emergency =
    isGasEmergencyText(text) || resolveUrgencyPolicy({ text }).band === "emergency"
  const specificExterior = text.match(SPECIFIC_EXTERIOR)?.[0]?.replace(/\s+/g, " ").trim()
  const bathroomNamed = /\bbath(?:room)?\b/i.test(text)
  const bedroomNamed = /\bbed\s?room\b/i.test(text)
  const bathroomSpecific = !bathroomNamed || countIsOne(input.bathroomCount) ||
    qualifiedPlace(text, "bathroom") != null
  const bedroomSpecific = !bedroomNamed || countIsOne(input.bedroomCount) ||
    qualifiedPlace(text, "bedroom") != null
  const interior = text.match(SPECIFIC_INTERIOR)?.[0]?.replace(/\s+/g, " ").trim().toLowerCase()
  const fixture = text.match(FIXTURE)?.[1]?.toLowerCase()
  const vagueOutside = VAGUE_EXTERIOR.test(text) && !specificExterior
  const floorOnly = FLOOR_ONLY.test(text) && !bathroomNamed && !bedroomNamed && !interior && !specificExterior

  if (emergency) {
    const location = specificExterior?.toLowerCase() ||
      (bathroomNamed ? qualifiedPlace(text, "bathroom") ?? "bathroom" : null) ||
      (bedroomNamed ? qualifiedPlace(text, "bedroom") ?? "bedroom" : null) ||
      interior ||
      null
    return { location, question: null }
  }

  if (bathroomNamed && !bathroomSpecific) {
    return { location: null, question: "Which bathroom is it in?" }
  }
  if (bedroomNamed && !bedroomSpecific) {
    return { location: null, question: "Which bedroom is it in?" }
  }
  if (vagueOutside) {
    return { location: null, question: outsideAsk(text) }
  }
  if (floorOnly) {
    return { location: null, question: "Which room on that floor is it in?" }
  }

  if (specificExterior) {
    return { location: specificExterior.toLowerCase(), question: null }
  }
  if (bathroomNamed && bathroomSpecific) {
    return {
      location: qualifiedPlace(text, "bathroom") ?? "bathroom",
      question: null,
    }
  }
  if (bedroomNamed && bedroomSpecific) {
    return {
      location: qualifiedPlace(text, "bedroom") ?? "bedroom",
      question: null,
    }
  }
  if (interior && fixture) {
    return { location: `${interior} ${fixture}`.replace(/\s+/g, " "), question: null }
  }
  if (interior) return { location: interior, question: null }
  if (fixture && !isWholeHomeSystem(text)) {
    const noun = fixture === "tap" ? "faucet" : fixture === "tub" ? "bathtub" : fixture
    return { location: null, question: problemAsk(text, noun) }
  }
  if (isWholeHomeSystem(text)) return { location: null, question: null }
  if (AMBIGUOUS_ROOM.test(text)) {
    return {
      location: null,
      question: /\bbath/i.test(text) ? "Which bathroom is it in?" : "Which bedroom is it in?",
    }
  }
  return { location: null, question: "Where in the home is this happening?" }
}
