import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { answerFromUploadedText } from "../tools/maintenance/reportedFactAnswer.ts"

export const UPLOADED_DOCUMENT_PASTE =
  "I can help review a document, but I do not have its contents in this conversation. Please name the property and document, and paste the relevant clause or text. I cannot verify what an uploaded lease, policy, or report says from its title alone."

export const UPLOADED_DOCUMENT_MISSING_DETAIL =
  "I read the uploaded document, but that detail is not in the text I could extract. Paste the relevant clause and I will review it."

export async function lookupUploadedDocumentAnswer(
  supabase: SupabaseClient,
  landlordId: string,
  question: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("landlord_uploaded_documents")
    .select("extracted_text")
    .eq("landlord_id", landlordId)
    .order("created_at", { ascending: false })
    .limit(8)
  if (error || !data?.length) return null
  let sawText = false
  for (const row of data) {
    const text = typeof row.extracted_text === "string" ? row.extracted_text : ""
    if (text.trim()) sawText = true
    const answer = answerFromUploadedText(question, text)
    if (answer) return answer
  }
  return sawText ? UPLOADED_DOCUMENT_MISSING_DETAIL : null
}
