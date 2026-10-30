/** Bound transport AND response parsing; abort even if a fetch implementation ignores it. */
export async function withDeadline<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Request deadline exceeded', 'TimeoutError')
      controller.abort(error)
      reject(error)
    }, ms)
  })
  try { return await Promise.race([task(controller.signal), deadline]) }
  finally { clearTimeout(timer) }
}
export const withAiDeadline = withDeadline
