export function isInspectionDocumentFile(
  fileName?: string | null,
  contentType?: string | null,
): boolean {
  const type = (contentType ?? "").toLowerCase()
  const name = (fileName ?? "").toLowerCase()
  return type.includes("pdf") || name.endsWith(".pdf")
}

export function inspectionRemovalActivity(isDocument: boolean): {
  eventType: "inspection.report_removed" | "inspection.photo_removed"
  message: string
} {
  if (isDocument) {
    return {
      eventType: "inspection.report_removed",
      message: "An inspection report was removed from this property.",
    }
  }
  return {
    eventType: "inspection.photo_removed",
    message: "An inspection photo was removed.",
  }
}
