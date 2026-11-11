export type SubmitResidentCandidate = {
  id: string
  email: string
  unit: string
  landlordId: string
  supabaseUserId: string | null
}

export type SubmitResidentChoice =
  | { ok: true; resident: SubmitResidentCandidate }
  | { ok: false; status: 403 | 409 | 422; error: string }

/**
 * The signed-in resident, not the form's landlord id, owns the request.
 * Email plus unit is not enough when that pair exists on more than one account.
 */
export function chooseResidentForSubmit(input: {
  linkedResidents: SubmitResidentCandidate[]
  emailUnitMatches: SubmitResidentCandidate[]
  formLandlordId: string | null
}): SubmitResidentChoice {
  const formLandlord = input.formLandlordId?.trim() || ""
  if (input.linkedResidents.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "This login is linked to more than one resident.",
    }
  }
  const resident = input.linkedResidents.length === 1
    ? input.linkedResidents[0]
    : input.emailUnitMatches.length === 1
    ? input.emailUnitMatches[0]
    : null
  if (input.linkedResidents.length === 0 && input.emailUnitMatches.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "More than one resident matches this email and unit.",
    }
  }
  if (!resident) {
    return {
      ok: false,
      status: 403,
      error: "No resident on this account matches this email and unit.",
    }
  }
  if (!resident.landlordId.trim()) {
    return {
      ok: false,
      status: 422,
      error: "This resident is not assigned to a property account.",
    }
  }
  if (formLandlord && formLandlord !== resident.landlordId) {
    return {
      ok: false,
      status: 403,
      error: "This request does not belong to that property account.",
    }
  }
  return { ok: true, resident }
}
