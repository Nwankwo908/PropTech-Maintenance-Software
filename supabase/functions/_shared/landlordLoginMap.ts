/**
 * Auth login email → landlords.id for seeded portal accounts.
 * public.landlords.email is the onboarding contact field and may not match login.
 */
export const SEEDED_LOGIN_EMAIL_TO_LANDLORD_ID: Record<string, string> = {
  "limitedalpha1@ulohome.io": "de300000-0000-4000-8000-000000000003",
  "limitedalpha2@ulohome.io": "de300000-0000-4000-8000-000000000004",
  "ceorentalsnj@gmail.com": "de300000-0000-4000-8000-000000000003",
  "iokafor0@gmail.com": "de300000-0000-4000-8000-000000000004",
  "moreceo@gmail.com": "de300000-0000-4000-8000-000000000004",
  "nyshaunbrown@gmail.com": "de300000-0000-4000-8000-000000000004",
  "otbpictures12@gmail.com": "de300000-0000-4000-8000-000000000004",
  "demo@ulohome.io": "de300000-0000-4000-8000-000000000001",
}

export function landlordIdForPortalLoginEmail(email: string): string | null {
  const key = email.trim().toLowerCase()
  return SEEDED_LOGIN_EMAIL_TO_LANDLORD_ID[key] ?? null
}
