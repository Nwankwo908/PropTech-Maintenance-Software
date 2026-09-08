/** Team member (backup contact) stored on onboarding / organization settings. */

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export type LandlordTeamMemberContact = {
  name: string
  email: string
  phone: string
}

export function teamMemberContactFromOnboarding(onboarding: {
  draft_state?: unknown
  account_settings?: unknown
} | null | undefined): LandlordTeamMemberContact {
  const draft =
    onboarding?.draft_state && typeof onboarding.draft_state === 'object'
      ? (onboarding.draft_state as Record<string, unknown>)
      : {}
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  const settings =
    onboarding?.account_settings && typeof onboarding.account_settings === 'object'
      ? (onboarding.account_settings as Record<string, unknown>)
      : {}
  const org = {
    ...((draft.organizationSettings ?? {}) as Record<string, unknown>),
    ...((settings.organization ?? {}) as Record<string, unknown>),
  }
  return {
    name:
      asTrimmed(account.backupContactName) ||
      asTrimmed(account.backup_contact_name) ||
      asTrimmed(org.backupContactName) ||
      asTrimmed(org.backup_contact_name),
    email:
      asTrimmed(account.backupContactEmail) ||
      asTrimmed(account.backup_contact_email) ||
      asTrimmed(org.backupContactEmail) ||
      asTrimmed(org.backup_contact_email),
    phone:
      asTrimmed(account.backupContactPhone) ||
      asTrimmed(account.backup_contact_phone) ||
      asTrimmed(org.backupContactPhone) ||
      asTrimmed(org.backup_contact_phone),
  }
}
