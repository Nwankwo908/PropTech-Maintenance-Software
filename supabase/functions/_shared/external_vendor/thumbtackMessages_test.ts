/// <reference lib="deno.ns" />

import {
  isThumbtackMessageCreatedEvent,
  parseThumbtackWebhookInbound,
  pickNegotiationId,
} from "./thumbtackMessageParse.ts"
import {
  resolveThumbtackRequestSearchIds,
  thumbtackCreateRequestBodies,
} from "./thumbtackMessages.ts"

Deno.test("same-token search IDs win over stale listing IDs", () => {
  const ids = resolveThumbtackRequestSearchIds({
    listingSearchId: "stale-search",
    listingCategoryId: "stale-cat",
    sameToken: { searchId: "fresh-search", categoryId: "fresh-cat" },
  })
  if (ids.searchId !== "fresh-search") throw new Error(ids.searchId)
  if (ids.categoryId !== "fresh-cat") throw new Error(ids.categoryId)
})

Deno.test("a user-token search can keep the listing category", () => {
  const ids = resolveThumbtackRequestSearchIds({
    listingSearchId: "stale-search",
    listingCategoryId: "listing-cat",
    sameToken: { searchId: "fresh-search", categoryId: "" },
  })
  if (ids.searchId !== "fresh-search") throw new Error(ids.searchId)
  if (ids.categoryId !== "listing-cat") throw new Error(ids.categoryId)
})

Deno.test("listing search IDs are never reused for request create", () => {
  const ids = resolveThumbtackRequestSearchIds({
    listingSearchId: "stale-search",
    listingCategoryId: "listing-cat",
    sameToken: null,
  })
  if (ids.searchId !== "") throw new Error(ids.searchId)
  if (ids.categoryId !== "listing-cat") throw new Error(ids.categoryId)
})

Deno.test("create-request prefers a searchID body then a category+zip body", () => {
  const bodies = thumbtackCreateRequestBodies({
    searchId: "s1",
    businessId: "b1",
    categoryId: "c1",
    utmSource: "cma-ulohome",
    zipCode: "33461",
    description: "Kitchen leak",
  })
  if (bodies[0].searchID !== "s1") throw new Error(JSON.stringify(bodies[0]))
  const withoutSearch = bodies.find((row) => !("searchID" in row) && !("searchId" in row))
  if (!withoutSearch) throw new Error("expected a category+zip body")
  if (withoutSearch.categoryID !== "c1") throw new Error(JSON.stringify(withoutSearch))
})

Deno.test("create-request can open from category and zip without a searchID", () => {
  const bodies = thumbtackCreateRequestBodies({
    searchId: "",
    businessId: "b1",
    categoryId: "c1",
    utmSource: "cma-ulohome",
    zipCode: "33461",
  })
  if (bodies.length !== 1) throw new Error(JSON.stringify(bodies))
  if ("searchID" in bodies[0] || "searchId" in bodies[0]) throw new Error(JSON.stringify(bodies[0]))
  if (bodies[0].categoryID !== "c1" || bodies[0].zipCode !== "33461") {
    throw new Error(JSON.stringify(bodies[0]))
  }
})

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
