/**
 * Shared household rent. Co-tenants each store the full lease rent, so a
 * household is counted once. The amount is the largest member rent, never
 * the sum of those copies.
 */

export type HouseholdRentMember = {
  id: string
  unit?: string | null
  building?: string | null
  status?: string | null
  monthlyRent?: number | null
  amountDue?: number | null
}

function propertyKey(building: string | null | undefined): string {
  return (building ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function unitKey(unit: string | null | undefined): string {
  return (unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/, '')
    .replace(/\s+/g, '')
}

/** Same property, and the same unit when one is present. Blank units share the property. */
export function householdRentPlaceKey(member: HouseholdRentMember): string | null {
  if ((member.status ?? '').trim().toLowerCase() === 'past_resident') return null
  const property = propertyKey(member.building)
  if (!property || property === 'portfolio') return null
  return `${property}::${unitKey(member.unit)}`
}

export function householdRentGroups<T extends HouseholdRentMember>(members: T[]): T[][] {
  const grouped = new Map<string, T[]>()
  const alone: T[][] = []
  for (const member of members) {
    const key = householdRentPlaceKey(member)
    if (!key) {
      alone.push([member])
      continue
    }
    const list = grouped.get(key) ?? []
    list.push(member)
    grouped.set(key, list)
  }
  return [...grouped.values(), ...alone]
}

/** One rent per household. Equal co-tenant copies are not added together. */
export function householdMonthlyRent(members: HouseholdRentMember[]): number {
  return householdRentGroups(members).reduce((sum, group) => {
    const amounts = group
      .map((member) => Number(member.monthlyRent ?? 0))
      .filter((amount) => Number.isFinite(amount) && amount > 0)
    if (amounts.length === 0) return sum
    return sum + Math.max(...amounts)
  }, 0)
}

/**
 * One billing lead per household. The amount is the largest member amount,
 * so two co-tenants stored at the full lease rent produce one charge.
 */
export function householdRentBillingAmounts(
  members: Array<HouseholdRentMember & { amountDue?: number | null }>,
): Map<string, number> {
  const amounts = new Map<string, number>()
  for (const group of householdRentGroups(members)) {
    const due = Math.max(
      0,
      ...group.map((member) => {
        const amount = Number(member.amountDue ?? 0)
        return Number.isFinite(amount) ? amount : 0
      }),
    )
    if (!(due > 0)) continue
    const lead = [...group].sort((left, right) => left.id.localeCompare(right.id))[0]
    if (lead) amounts.set(lead.id, due)
  }
  return amounts
}
