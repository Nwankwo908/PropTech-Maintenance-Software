/** Landlord-facing line when uploaded document text is saved. */
export function documentUploadActivityMessage(fileName: string): string {
  const name = fileName.replace(/\\/g, "/").split("/").pop()?.replace(/\s+/g, " ").trim() || "a document"
  return `Uploaded document ready to review: ${name}.`
}
