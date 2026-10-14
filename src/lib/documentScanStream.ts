export type DocumentScanEvent<T> = { stage: string; extracted: T | null }
/** Consume incremental lease results without treating a dropped stream as success. */
export async function readDocumentScanStream<T, R>(response: Response, onProgress?: (event: DocumentScanEvent<T>)=>void): Promise<R> {
  if (!response.body) throw new Error('Document scanning returned no result.')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', final: R | undefined
  const consume = (block:string) => {
    const event = block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim()
    const data = block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
    if (!data) return
    const value = JSON.parse(data)
    if (event === 'error') throw new Error(value.error || 'Document scanning failed.')
    if (event === 'progress') onProgress?.(value)
    if (event === 'result') final = value as R
  }
  try {
    while (true) {
      const {value,done} = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true})
      buffer = buffer.replace(/\r\n/g,'\n')
      let boundary: number
      while ((boundary=buffer.indexOf('\n\n'))>=0) {consume(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2)}
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
    if (!final) throw new Error('Document scanning stopped before completing. Your readable details are preserved; retry to finish.')
    return final
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock() }
}
