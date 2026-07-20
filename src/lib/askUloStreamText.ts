/** Client-side progressive text reveal while the ask-ulo API returns full answers. */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Split answer text into stream chunks (word groups, keeping whitespace).
 * Longer answers use larger chunks so reveal stays under ~2.5s.
 */
export function chunkAskUloAnswer(text: string): string[] {
  const tokens = text.split(/(\s+)/)
  if (tokens.length <= 1) return text ? [text] : []

  const wordCount = tokens.filter((t) => t.trim().length > 0).length
  const groupSize = wordCount > 400 ? 10 : wordCount > 180 ? 6 : wordCount > 80 ? 4 : 2

  const chunks: string[] = []
  let buf = ''
  let wordsInBuf = 0
  for (const token of tokens) {
    buf += token
    if (token.trim().length > 0) wordsInBuf += 1
    if (wordsInBuf >= groupSize) {
      chunks.push(buf)
      buf = ''
      wordsInBuf = 0
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

export async function streamAskUloAnswer(
  fullText: string,
  onUpdate: (partial: string) => void,
  options?: { signal?: AbortSignal; maxDurationMs?: number },
): Promise<void> {
  const text = fullText
  if (!text) {
    onUpdate('')
    return
  }

  const chunks = chunkAskUloAnswer(text)
  if (chunks.length <= 1) {
    onUpdate(text)
    return
  }

  const maxDuration = options?.maxDurationMs ?? 2400
  const delay = Math.max(10, Math.min(32, Math.floor(maxDuration / chunks.length)))

  let acc = ''
  for (const chunk of chunks) {
    if (options?.signal?.aborted) {
      onUpdate(text)
      return
    }
    acc += chunk
    onUpdate(acc)
    await sleep(delay)
  }
  onUpdate(text)
}
