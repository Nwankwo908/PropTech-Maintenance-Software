import { describe, expect, it } from "vitest"
import {
  landlordApprovalMediaFallbackLine,
  landlordApprovalMediaLine,
  residentMediaRefs,
} from "./landlordApprovalMedia.ts"

describe("resident media on the landlord approval text", () => {
  it("keeps photos and videos and drops documents and carrier links", () => {
    expect(
      residentMediaRefs([
        "sms/ticket/outlet.jpg",
        "sms/ticket/clip.mp4",
        "sms/ticket/lease.pdf",
        "https://api.twilio.com/2010-04-01/Accounts/AC/Media/ME",
        "",
      ]),
    ).toEqual(["sms/ticket/outlet.jpg", "sms/ticket/clip.mp4"])
  })

  it("names a single photo, a single video, and a mix", () => {
    expect(landlordApprovalMediaLine(["a.jpg"])).toBe("The resident sent this photo.")
    expect(landlordApprovalMediaLine(["a.mp4"])).toBe("The resident sent this video.")
    expect(landlordApprovalMediaLine(["a.jpg", "b.jpg"])).toBe("The resident sent these photos.")
    expect(landlordApprovalMediaLine(["a.jpg", "b.mp4"])).toBe(
      "The resident sent photos and a video.",
    )
    expect(landlordApprovalMediaLine([])).toBeNull()
  })

  it("says the file stays on the request when it cannot be attached", () => {
    expect(landlordApprovalMediaFallbackLine(["a.jpg"])).toBe(
      "The resident sent a photo. It is saved on the request.",
    )
    expect(landlordApprovalMediaFallbackLine(["a.mov"])).toBe(
      "The resident sent a video. It is saved on the request.",
    )
  })
})
