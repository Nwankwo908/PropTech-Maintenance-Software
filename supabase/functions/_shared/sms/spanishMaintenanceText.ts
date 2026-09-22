/**
 * Spanish → English bridge for inbound maintenance texts.
 *
 * The deterministic rules, the emergency net and the urgency policy are all
 * written in English. Rather than keep a second Spanish rule set in sync, we
 * append the English equivalent of anything a resident wrote in Spanish and
 * run the same English rules over the result.
 */

const ES_TO_EN: Array<[RegExp, string]> = [
  // Life safety
  [/\b(huele|olor)\s+a\s+gas\b|\bfuga\s+de\s+gas\b|\bescape\s+de\s+gas\b/, "smell gas"],
  [/\bmonoxido\s+de\s+carbono\b/, "carbon monoxide"],
  [/\bincendio\b|\bfuego\b|\bllamas\b/, "fire"],
  [/\bhumo\b/, "smoke"],
  [/\bchispas?\b|\bchispea\b|\bhaciendo\s+chispas\b/, "sparking"],
  [/\binundacion\b|\binundad[oa]\b|\bse\s+inundo\b/, "flooding"],
  [/\bcongelando\b|\bmucho\s+frio\b|\bhelando\b/, "freezing"],

  // Plumbing
  [/\bno\s+hay\s+agua\s+caliente\b|\bsin\s+agua\s+caliente\b/, "no hot water"],
  [/\bcalentador\s+de\s+agua\b|\bboiler\b/, "water heater"],
  [/\bfuga\s+de\s+agua\b|\bgotera\b|\bgotea\b|\bgoteando\b/, "leak"],
  [/\btuberia\b|\bcaneria\b/, "pipe"],
  [/\bino?doro\b|\bexcusado\b|\btaza\s+del\s+bano\b/, "toilet"],
  [/\bfregadero\b|\blavamanos\b|\blavabo\b/, "sink"],
  [/\bllave\s+del\s+agua\b|\bgrifo\b/, "faucet"],
  [/\btapad[oa]\b|\batascad[oa]\b|\bobstruid[oa]\b/, "clogged drain"],
  [/\bdrenaje\b|\bdesague\b/, "drain"],

  // Heat / cooling
  [/\bno\s+hay\s+calefaccion\b|\bsin\s+calefaccion\b|\bno\s+sirve\s+la\s+calefaccion\b/, "no heat"],
  [/\bcalefaccion\b|\bcalefactor\b/, "heat"],
  [/\baire\s+acondicionado\b|\bclima\b/, "air conditioner"],
  [/\bno\s+enfria\b/, "not cooling"],

  // Electrical
  [/\bno\s+hay\s+(?:luz|electricidad)\b|\bsin\s+(?:luz|electricidad)\b/, "no power"],
  [/\belectricidad\b|\belectrico\b/, "electrical"],
  [/\benchufe\b|\btomacorriente\b/, "outlet"],
  [/\bfoco\b|\bbombilla\b|\blampara\b/, "light"],

  // Appliances
  [/\brefrigerador\b|\bnevera\b|\brefri\b/, "refrigerator"],
  [/\bestufa\b|\bhorno\b/, "stove oven"],
  [/\blavadora\b/, "washer"],
  [/\bsecadora\b/, "dryer"],
  [/\blavaplatos\b|\blavavajillas\b/, "dishwasher"],

  // Pests
  [/\bplagas?\b|\bcucarachas?\b|\bratones?\b|\bratas?\b|\bchinches\b|\bhormigas\b/, "pest"],
  [/\bfumigacion\b|\bfumigar\b/, "exterminator"],

  // Locks / doors / windows
  [/\bcerradura\b|\bchapa\s+de\s+la\s+puerta\b/, "lock"],
  [/\bme\s+quede\s+afuera\b|\bno\s+puedo\s+entrar\b/, "locked out"],
  [/\bpuerta\b/, "door"],
  [/\bventana\b/, "window"],

  // General problem signals
  [/\bno\s+(?:funciona|sirve|prende|enciende)\b|\bdejo\s+de\s+funcionar\b/, "not working"],
  [/\brot[oa]\b|\bquebrad[oa]\b|\bdescompuest[oa]\b|\bdanad[oa]\b/, "broken"],
  [/\breparacion\b|\barreglar\b|\breparar\b|\bcomponer\b/, "repair"],
  [/\bmantenimiento\b/, "maintenance"],
  [/\bemergencia\b/, "emergency"],
  [/\btecho\b/, "ceiling roof"],
  [/\bpared\b/, "wall"],
  [/\bpiso\b/, "floor"],
  [/\bpintura\b/, "paint"],
  [/\bcesped\b|\bjardin\b/, "lawn"],
]

/** Lowercase and drop accents so one pattern matches "monóxido" and "monoxido". */
export function foldSpanishText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Original text plus the English equivalent of any Spanish maintenance terms.
 * English-only messages come back unchanged.
 */
export function bridgeSpanishMaintenanceText(text: string): string {
  const folded = foldSpanishText(text)
  if (!folded.trim()) return text

  const added: string[] = []
  for (const [pattern, english] of ES_TO_EN) {
    if (pattern.test(folded) && !folded.includes(english)) added.push(english)
  }
  if (added.length === 0) return text
  return `${text} ${[...new Set(added)].join(" ")}`
}
