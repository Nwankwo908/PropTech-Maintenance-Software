import {
  localeForPreferredLanguage,
  type PreferredLanguageId,
} from "./rentCollectionPolicy.ts"

export type RentOutreachCopyInput = {
  amountDue: number | null | undefined
  rentDueDate: string | null | undefined
  paymentLink?: string | null
  residentName?: string | null
  daysBeforeDue?: number | null
  language?: PreferredLanguageId
}

function formatCurrency(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount)
}

function duePhrase(
  rentDueDate: string,
  daysBeforeDue: number | null | undefined,
  locale: string,
): string {
  const due = new Date(`${rentDueDate.slice(0, 10)}T12:00:00`)
  const formatted = due.toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
  })

  if (daysBeforeDue === 0) {
    return locale.startsWith("es") ? "hoy" : "today"
  }
  if (daysBeforeDue === 1) {
    return locale.startsWith("es")
      ? `mañana (${formatted})`
      : `tomorrow (${formatted})`
  }
  return locale.startsWith("es") ? `el ${formatted}` : `on ${formatted}`
}

export function buildRentCollectionPrompt(input: RentOutreachCopyInput): string {
  const language = input.language ?? "en_us"
  const locale = localeForPreferredLanguage(language)
  const amount = input.amountDue != null && Number.isFinite(input.amountDue)
    ? formatCurrency(input.amountDue, locale)
    : language === "es_us"
    ? "su saldo"
    : "your balance"
  const due = input.rentDueDate?.trim()
    ? duePhrase(input.rentDueDate, input.daysBeforeDue, locale)
    : language === "es_us"
    ? "pronto"
    : "soon"
  const payLine = input.paymentLink
    ? language === "es_us"
      ? ` Puede pagar en línea aquí: ${input.paymentLink}.`
      : ` You can pay online here: ${input.paymentLink}.`
    : ""

  if (language === "es_us") {
    return (
      `Hola, somos el equipo de administración de su propiedad. ` +
      `Le recordamos amablemente que su renta de ${amount} vence ${due}.${payLine} ` +
      `Cuando haya pagado, responda PAGADO. Si pagó una parte, responda PARCIAL. ` +
      `¿Tiene alguna pregunta? Responda PREGUNTA y le ayudaremos.`
    )
  }

  return (
    `Hi, this is a friendly reminder from your property management team. ` +
    `Your rent of ${amount} is due ${due}.${payLine} ` +
    `Once you've paid, reply PAID. If you paid part of it, reply PARTIAL. ` +
    `Have a question? Reply QUESTIONS and we'll help.`
  )
}

export function buildRentCollectionEmailBody(input: RentOutreachCopyInput): {
  subject: string
  text: string
  html: string
} {
  const language = input.language ?? "en_us"
  const locale = localeForPreferredLanguage(language)
  const residentName = input.residentName?.trim() ||
    (language === "es_us" ? "Residente" : "Resident")
  const amount = input.amountDue != null && Number.isFinite(input.amountDue)
    ? formatCurrency(input.amountDue, locale)
    : language === "es_us"
    ? "su saldo"
    : "your balance"
  const due = input.rentDueDate?.trim()
    ? duePhrase(input.rentDueDate, input.daysBeforeDue, locale)
    : language === "es_us"
    ? "este mes"
    : "this month"

  if (language === "es_us") {
    const subject = input.daysBeforeDue === 0
      ? "Recordatorio: su renta vence hoy"
      : `Recordatorio: su renta vence ${due}`
    const payText = input.paymentLink
      ? `\n\nPuede pagar en línea aquí: ${input.paymentLink}`
      : ""
    const payHtml = input.paymentLink
      ? `<p><a href="${input.paymentLink}">Pague su renta en línea</a></p>`
      : ""
    const text =
      `Hola ${residentName},\n\nSomos el equipo de administración de su propiedad. ` +
      `Le recordamos amablemente que su renta de ${amount} vence ${due}. ` +
      `Envíe su pago cuando pueda.${payText}\n\n` +
      `Si ya pagó, responda PAGADO a su línea de texto de la propiedad — o contáctenos en cualquier momento.\n\n` +
      `Gracias,\nSu equipo de administración`
    const html =
      `<p>Hola ${residentName},</p>` +
      `<p>Somos el equipo de administración de su propiedad. Le recordamos amablemente que su renta de <strong>${amount}</strong> vence ${due}. Envíe su pago cuando pueda.</p>` +
      `${payHtml}` +
      `<p>Si ya pagó, responda <strong>PAGADO</strong> a su línea de texto de la propiedad — o contáctenos en cualquier momento.</p>` +
      `<p>Gracias,<br/>Su equipo de administración</p>`
    return { subject, text, html }
  }

  const subject = input.daysBeforeDue === 0
    ? "Friendly reminder: rent is due today"
    : `Friendly reminder: rent is due ${due}`
  const payText = input.paymentLink
    ? `\n\nYou can pay online here: ${input.paymentLink}`
    : ""
  const payHtml = input.paymentLink
    ? `<p><a href="${input.paymentLink}">Pay your rent online</a></p>`
    : ""
  const text =
    `Hi ${residentName},\n\nThis is a friendly reminder from your property management team. ` +
    `Your rent of ${amount} is due ${due}. Please submit your payment when you can.${payText}\n\n` +
    `If you've already paid, reply PAID to your property text line — or reach out anytime and we're happy to help.\n\n` +
    `Thank you,\nYour property management team`
  const html =
    `<p>Hi ${residentName},</p>` +
    `<p>This is a friendly reminder from your property management team. Your rent of <strong>${amount}</strong> is due ${due}. Please submit your payment when you can.</p>` +
    `${payHtml}` +
    `<p>If you've already paid, reply <strong>PAID</strong> to your property text line — or reach out anytime and we're happy to help.</p>` +
    `<p>Thank you,<br/>Your property management team</p>`
  return { subject, text, html }
}
