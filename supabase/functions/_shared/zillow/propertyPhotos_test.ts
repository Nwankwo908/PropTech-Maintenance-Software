/// <reference lib="deno.ns" />

import {
  collectZillowPhotoUrls,
  collectZillowPhotoUrlsFromHtml,
  isZillowPhotoUrl,
  pickZillowZpid,
  zillowAddressQueryVariants,
  zillowRapidApiHosts,
} from "./propertyPhotos.ts"

Deno.test("isZillowPhotoUrl allows zillowstatic https", () => {
  if (
    !isZillowPhotoUrl("https://photos.zillowstatic.com/fp/example-p_e.jpg")
  ) {
    throw new Error("expected allowed")
  }
  if (isZillowPhotoUrl("http://photos.zillowstatic.com/fp/example.jpg")) {
    throw new Error("http should be rejected")
  }
  if (isZillowPhotoUrl("https://evil.example/x.jpg")) {
    throw new Error("other hosts should be rejected")
  }
})

Deno.test("collectZillowPhotoUrls reads listing CDN urls from mixed payloads", () => {
  const urls = collectZillowPhotoUrls({
    zpid: 445566,
    imgSrc: "https://photos.zillowstatic.com/fp/thumb-p_c.jpg",
    originalPhotos: [
      {
        mixedSources: {
          jpeg: [
            { url: "https://photos.zillowstatic.com/fp/a-cc_ft_384.jpg", width: 384 },
            { url: "https://photos.zillowstatic.com/fp/a-cc_ft_1536.jpg", width: 1536 },
          ],
        },
      },
    ],
  })
  for (const expected of [
    "https://photos.zillowstatic.com/fp/thumb-p_c.jpg",
    "https://photos.zillowstatic.com/fp/a-cc_ft_384.jpg",
    "https://photos.zillowstatic.com/fp/a-cc_ft_1536.jpg",
  ]) {
    if (!urls.includes(expected)) throw new Error(`missing ${expected}: ${urls.join(",")}`)
  }
})

Deno.test("pickZillowZpid reads nested search hits", () => {
  const id = pickZillowZpid({
    props: [{ zpid: "998877" }],
  })
  if (id !== "998877") throw new Error(String(id))
})

Deno.test("zillowAddressQueryVariants inserts a comma after the street", () => {
  const variants = zillowAddressQueryVariants("109 S Grove St Newark, NJ 07112")
  if (!variants.includes("109 S Grove St, Newark, NJ 07112")) {
    throw new Error(variants.join(" | "))
  }
})

Deno.test("collectZillowPhotoUrlsFromHtml reads listing CDN urls", () => {
  const urls = collectZillowPhotoUrlsFromHtml(
    `<meta property="og:image" content="https://photos.zillowstatic.com/fp/abc-p_e.jpg" />`,
  )
  if (urls[0] !== "https://photos.zillowstatic.com/fp/abc-p_e.jpg") {
    throw new Error(String(urls[0]))
  }
})

Deno.test("zillowRapidApiHosts only uses zillow-com1", () => {
  const hosts = zillowRapidApiHosts("zillow-property-data1.p.rapidapi.com")
  if (hosts.join(",") !== "zillow-com1.p.rapidapi.com") throw new Error(hosts.join(","))
})

Deno.test("collectZillowPhotoUrls reads image_urls from listing payloads", () => {
  const urls = collectZillowPhotoUrls({
    status: "complete",
    results: [
      {
        property: {
          zpid: 20794780,
          image_urls: [
            "https://photos.zillowstatic.com/fp/listing-p_e.jpg",
            "https://photos.zillowstatic.com/fp/kitchen-p_e.jpg",
          ],
        },
      },
    ],
  })
  if (urls.length !== 2) throw new Error(String(urls.length))
})

