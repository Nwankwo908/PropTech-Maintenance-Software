/** Resident rent status classification for rent_collection workflow runs. */
export type RentCollectionClassification =
  | "rent_due_today"
  | "rent_overdue"
  | "partial_payment"
  | "paid"
  | "payment_plan_needed"

export type PaymentIntent = "paid" | "partial" | "questions"

export type ClassifyRentCollectionInput = {
  balanceDue: number
  rentDueDate: string
  /** Resident SMS reply, when classifying an inbound message. */
  paymentIntent?: PaymentIntent | null
  /** Prior classification preserved when still applicable. */
  priorClassification?: RentCollectionClassification | null
  /** Original amount due when the run started (detect partial balance reduction). */
  originalAmountDue?: number | null
  date?: Date
}

export type RentClassificationMetadata = {
  rent_classification: RentCollectionClassification
  classified_at: string
  classification_source: "balance_and_due_date" | "payment_intent" | "balance_update"
}

function todayIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function classificationFromPaymentIntent(
  intent: PaymentIntent,
): RentCollectionClassification {
  switch (intent) {
    case "paid":
      return "paid"
    case "partial":
      return "partial_payment"
    case "questions":
      return "payment_plan_needed"
  }
}

/**
 * Classify a resident's rent status for rent_collection.
 * SMS payment intent takes precedence; otherwise balance + due date apply.
 */
export function classifyRentCollection(
  input: ClassifyRentCollectionInput,
): RentCollectionClassification {
  if (input.paymentIntent) {
    return classificationFromPaymentIntent(input.paymentIntent)
  }

  if (input.balanceDue <= 0) {
    return "paid"
  }

  const original = input.originalAmountDue
  if (
    original != null &&
    Number.isFinite(original) &&
    original > 0 &&
    input.balanceDue > 0 &&
    input.balanceDue < original
  ) {
    return "partial_payment"
  }

  if (input.priorClassification === "partial_payment" && input.balanceDue > 0) {
    return "partial_payment"
  }

  if (input.priorClassification === "payment_plan_needed" && input.balanceDue > 0) {
    return "payment_plan_needed"
  }

  const date = input.date ?? new Date()
  const today = todayIso(date)
  const dueDate = input.rentDueDate.trim().slice(0, 10)

  if (today === dueDate) {
    return "rent_due_today"
  }

  if (today > dueDate) {
    return "rent_overdue"
  }

  return "rent_due_today"
}

export function buildRentClassificationMetadata(
  classification: RentCollectionClassification,
  source: RentClassificationMetadata["classification_source"],
  date = new Date(),
): RentClassificationMetadata {
  return {
    rent_classification: classification,
    classified_at: date.toISOString(),
    classification_source: source,
  }
}

export function readRentClassification(
  metadata: Record<string, unknown> | null | undefined,
): RentCollectionClassification | null {
  const value = metadata?.rent_classification
  if (
    value === "rent_due_today" ||
    value === "rent_overdue" ||
    value === "partial_payment" ||
    value === "paid" ||
    value === "payment_plan_needed"
  ) {
    return value
  }
  return null
}
