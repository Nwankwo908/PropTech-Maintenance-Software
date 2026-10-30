/** Cheap payload checks run before remote authentication and retrieval. */
export function validateAskUloRequest(body: Record<string, unknown>): string | null {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  if (!text(body.landlordId ?? body.landlord_id)) return 'landlordId is required'
  const action = text(body.action)
  if (action === 'feedback') {
    if (!text(body.evalId ?? body.eval_id)) return 'evalId is required'
    if (body.rating !== 'up' && body.rating !== 'down') return 'rating must be up or down'
    return null
  }
  if (action === 'counsel_handoff') return text(body.expertRole ?? body.expert_role) ? null : 'expertRole is required'
  if (action) return 'Unknown action'
  const question = text(body.question)
  if (!question) return 'question is required'
  if (question.length > 4000) return 'question is too long'
  const history = body.messages ?? body.history
  if (history != null && !Array.isArray(history)) return 'history must be an array'
  return null
}
