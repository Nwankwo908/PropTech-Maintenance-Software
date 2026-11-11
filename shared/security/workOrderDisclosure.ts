/**
 * A work-order link proves which job was opened. It does not prove the caller
 * is the assigned vendor. Entry credentials and the resident phone stay hidden
 * until a verified vendor session is present.
 */

export type WorkOrderEntryAccess = {
  buildingEntry: string
  gateCode: string
  lockboxLocation: string
  lockboxCode: string
  utilityRoomAccess: string
  visitorParking: string
  superintendentContact: string
  emergencyAccessNotes: string
}

export type WorkOrderDisclosureInput = {
  vendorSessionVerified: boolean
  residentPhone: string | null
  accessInstructions: string | null
  propertyAccess: WorkOrderEntryAccess | null
}

export type WorkOrderDisclosure = {
  residentPhone: string | null
  accessInstructions: string | null
  propertyAccess: WorkOrderEntryAccess | null
}

export function discloseWorkOrderSensitiveFields(
  input: WorkOrderDisclosureInput,
): WorkOrderDisclosure {
  if (!input.vendorSessionVerified) {
    return {
      residentPhone: null,
      accessInstructions: null,
      propertyAccess: null,
    }
  }
  return {
    residentPhone: input.residentPhone,
    accessInstructions: input.accessInstructions,
    propertyAccess: input.propertyAccess,
  }
}
