import type { OnboardingAccountSetup } from '@/lib/landlordOnboarding'

export type SidebarAdminProfile = {
  name: string
  email: string
  initials: string
}

export function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function formatNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim() ?? ''
  if (!local) return email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function profileFromAccountSetup(
  accountSetup: OnboardingAccountSetup,
): SidebarAdminProfile | null {
  const name = accountSetup.contactName.trim()
  const email = accountSetup.email.trim()
  if (!name && !email) return null

  const displayName = name || formatNameFromEmail(email)
  return {
    name: displayName,
    email: email || '',
    initials: contactInitials(displayName),
  }
}

export function profileFromSessionUser(
  email: string | null | undefined,
  displayName?: string | null,
): SidebarAdminProfile | null {
  const normalizedEmail = email?.trim() ?? ''
  if (!normalizedEmail) return null

  const name = displayName?.trim() || formatNameFromEmail(normalizedEmail)
  return {
    name,
    email: normalizedEmail,
    initials: contactInitials(name),
  }
}
