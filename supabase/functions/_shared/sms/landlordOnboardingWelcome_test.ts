import {
  buildLandlordOnboardingWelcomeEmail,
  buildLandlordOnboardingWelcomeSms,
  collectLandlordWelcomeEmails,
} from "./landlordOnboardingWelcome.ts"

Deno.test("landlord onboarding welcome SMS includes dashboard and intake number", () => {
  const body = buildLandlordOnboardingWelcomeSms({
    contactFirst: "Alex",
    companyName: "Oakwood Properties",
    dashboardUrl: "https://app.ulohome.io/admin",
    smsIntakeDisplay: "+1 (877) 580-3356",
  })
  if (!body.includes("Hi Alex,")) throw new Error("missing greeting")
  if (!body.includes("Oakwood Properties")) throw new Error("missing company")
  if (!body.includes("+1 (877) 580-3356")) throw new Error("missing intake number")
  if (!body.includes("https://app.ulohome.io/admin")) throw new Error("missing dashboard url")
})

Deno.test("landlord onboarding welcome SMS uses [name] properties without a company", () => {
  const body = buildLandlordOnboardingWelcomeSms({
    contactFirst: "Alex",
    companyName: "Alex Rivera properties",
    dashboardUrl: "https://app.ulohome.io/admin",
    smsIntakeDisplay: null,
  })
  if (!body.includes("Alex Rivera properties")) {
    throw new Error("missing name-properties label")
  }
  if (body.includes("your portfolio")) throw new Error("should not use your portfolio")
})
  const mail = buildLandlordOnboardingWelcomeEmail({
    contactFirst: "Alex",
    companyName: "Oakwood Properties",
    dashboardUrl: "https://app.ulohome.io/admin",
    smsIntakeDisplay: null,
  })
  if (!mail.subject.includes("complete")) throw new Error("unexpected subject")
  if (mail.text.includes("Residents can report maintenance")) {
    throw new Error("should omit intake line")
  }
})

Deno.test("welcome emails keep the landlord address even if a vendor reused it", () => {
  const emails = collectLandlordWelcomeEmails({
    landlordEmail: "ceorentalsnj@gmail.com",
    accountEmail: "ceorentalsnj@gmail.com",
    requestedEmail: "  CEORENTALSNJ@gmail.com ",
  })
  if (emails.length !== 1 || emails[0] !== "ceorentalsnj@gmail.com") {
    throw new Error(`expected one landlord email, got ${JSON.stringify(emails)}`)
  }
})
