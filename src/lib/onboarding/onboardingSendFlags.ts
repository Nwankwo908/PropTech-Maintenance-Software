/**
 * Match Onboarding-switch flags from AI review / guided forms onto the
 * persisted roster. Resident matching must be as robust as vendor matching —
 * extraction ids differ from `users.id` after import.
 */
export function residentOnboardingFlagMatchKeys(row: {
  id?: string
  fullName?: string
  name?: string
  unit?: string
  phone?: string
}): string[] {
  const keys: string[] = []
  const id = (row.id ?? '').trim()
  if (id) keys.push(`id:${id}`)

  const name = (row.fullName ?? row.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (name) keys.push(`name:${name}`)

  const digits = (row.phone ?? '').replace(/\D/g, '')
  if (digits.length >= 10) keys.push(`phone:${digits.slice(-10)}`)

  const unit = (row.unit ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (name && unit) keys.push(`name_unit:${name}|${unit}`)

  return keys
}

export function vendorOnboardingFlagMatchKeys(row: {
  id?: string
  name?: string
  phone?: string
  email?: string
}): string[] {
  const keys: string[] = []
  const id = (row.id ?? '').trim()
  if (id) keys.push(`id:${id}`)
  const name = (row.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (name) keys.push(`name:${name}`)
  const digits = (row.phone ?? '').replace(/\D/g, '')
  if (digits.length >= 10) keys.push(`phone:${digits.slice(-10)}`)
  const email = (row.email ?? '').trim().toLowerCase()
  if (email) keys.push(`email:${email}`)
  return keys
}

export function applyOnboardingSendFlags<T extends { sendOnboardingOnComplete?: boolean }>(
  roster: T[],
  sources: Array<{ sendOnboardingOnComplete?: boolean }>,
  keysFor: (row: T | (typeof sources)[number]) => string[],
): T[] {
  const flagByKey = new Map<string, boolean>()
  for (const row of sources) {
    const enabled = Boolean(row.sendOnboardingOnComplete)
    for (const key of keysFor(row)) {
      flagByKey.set(key, Boolean(flagByKey.get(key) || enabled))
    }
  }
  return roster.map((row) => ({
    ...row,
    sendOnboardingOnComplete: Boolean(
      row.sendOnboardingOnComplete || keysFor(row).some((key) => flagByKey.get(key)),
    ),
  }))
}
