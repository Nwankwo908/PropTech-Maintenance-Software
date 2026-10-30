/** Landlord-facing lines for one Home Check photo observation. */
export function homeCheckPhotoObservations(warning: string): string[] {
  const clauses = warning.split(/[;\n]+/).map((part) => part.trim()).filter(Boolean)
  const lines: string[] = []
  for (const clause of clauses) {
    const line = observationForClause(clause)
    if (line && !lines.includes(line)) lines.push(line)
  }
  return lines
}

function observationForClause(clause: string): string | null {
  const text = clause.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (/no (?:catch|drain) pan|missing (?:catch|drain) pan|without a (?:catch|drain) pan/i.test(text)) {
    return 'No drain pan visible under the water heater'
  }
  if (/TPR|relief.?valve|discharge/i.test(text)) {
    if (/loop|upward|upwards|does not reach|doesn't reach|not reach|short of the floor|above the floor/i.test(text)) {
      return "Relief valve pipe doesn't reach the floor"
    }
    const cleaned = text.replace(/\bTPR\b/gi, 'relief valve')
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[.;]+$/, '')
  }
  if (/catch pan|drain pan|pan drain/i.test(text)) {
    return 'No drain pan visible under the water heater'
  }
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/[.;]+$/, '')
}

export function homeCheckPhotoReviewCopy(warning: string): string {
  return ['Ulo spotted something in a photo.', ...homeCheckPhotoObservations(warning)].join(' ')
}

export function homeCheckCloserPhotoSms(company: string, warning: string): string {
  const seen = homeCheckPhotoObservations(warning)
  const detail = seen.length ? `${seen.join('. ')}.` : 'Something in the equipment photo needs a clearer look.'
  return [
    `This is the property management team at ${company}.`,
    `Please send a closer photo. Ulo spotted something in a photo: ${detail}`,
    'Reply to this text with the photo.',
  ].join('\n\n')
}
