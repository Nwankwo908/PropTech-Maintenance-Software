/// <reference lib="deno.ns" />

import {
  isThumbtackMessageCreatedEvent,
  parseThumbtackWebhookInbound,
  pickNegotiationId,
} from "./thumbtackMessageParse.ts"

Deno.test("pickNegotiationId walks nested partner payloads", () => {
  const id = pickNegotiationId({
    data: {
      requestID: "req-1",
      negotiations: [{ businessID: "b1", negotiationID: "neg-99" }],
    },
  })
  if (id !== "neg-99") throw new Error(`expected neg-99, got ${id}`)
})

Deno.test("parseThumbtackWebhookInbound reads MessageCreatedV4", () => {
  const inbound = parseThumbtackWebhookInbound({
    eventType: "MessageCreatedV4",
    data: {
      negotiationID: "neg-1",
      businessID: "biz-2",
      message: { text: "We can come Thursday.", userType: "business", messageID: "m-9" },
    },
  })
  if (!isThumbtackMessageCreatedEvent(inbound.eventType)) throw new Error("event type")
  if (inbound.negotiationId !== "neg-1") throw new Error(String(inbound.negotiationId))
  if (inbound.businessId !== "biz-2") throw new Error(String(inbound.businessId))
  if (inbound.text !== "We can come Thursday.") throw new Error(String(inbound.text))
  if (!inbound.fromPro) throw new Error("fromPro")
})
