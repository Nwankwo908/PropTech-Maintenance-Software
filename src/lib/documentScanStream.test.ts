import { expect, it } from 'vitest'
import { readDocumentScanStream } from './documentScanStream'
const streamed = (text: string) => new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
it('delivers incremental UTF-8 fields before the final result, including CRLF frames', async () => {
  const progress: unknown[] = []
  const result = await readDocumentScanStream(streamed('event: progress\r\ndata: {"stage":"checking","extracted":{"tenant":"José"}}\r\n\r\nevent: result\r\ndata: {"hasData":true}\r\n\r\n'), event => progress.push(event))
  expect(progress).toEqual([{ stage: 'checking', extracted: { tenant: 'José' } }])
  expect(result).toEqual({ hasData: true })
})
it('preserves delivered partial fields but never treats a dropped stream as complete', async () => {
  const progress: unknown[] = []
  await expect(readDocumentScanStream(streamed('event: progress\ndata: {"stage":"checking","extracted":{"rent":1500}}\n\n'), event => progress.push(event))).rejects.toThrow('stopped before completing')
  expect(progress).toHaveLength(1)
})
it('surfaces an error event instead of an apparent successful upload', async () => {
  await expect(readDocumentScanStream(streamed('event: error\ndata: {"error":"Fixture provider unavailable"}\n\n'))).rejects.toThrow('Fixture provider unavailable')
})
