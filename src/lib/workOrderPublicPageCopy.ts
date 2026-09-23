export type JobPageLang = 'en' | 'es'

const STORAGE_KEY = 'ulo.jobDetail.language'

export function readJobPageLang(): JobPageLang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)?.trim().toLowerCase()
    if (stored === 'es' || stored === 'en') return stored
  } catch {
    /* ignore */
  }
  return 'en'
}

export function persistJobPageLang(lang: JobPageLang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

export function jobPageDateLocale(lang: JobPageLang): string {
  return lang === 'es' ? 'es-US' : 'en-US'
}

const ACCESS_LABEL_ES: Record<string, string> = {
  'Building entry instructions': 'Instrucciones de entrada al edificio',
  'Gate code': 'Código de la puerta',
  'Lockbox location': 'Ubicación de la caja de llaves',
  'Lockbox code': 'Código de la caja de llaves',
  'Utility room access': 'Acceso al cuarto de servicios',
  'Visitor parking': 'Estacionamiento para visitas',
  'Superintendent contact': 'Contacto del superintendente',
  'Emergency access notes': 'Notas de acceso de emergencia',
}

const TRADE_LABEL_ES: Record<string, string> = {
  Plumbing: 'Plomería',
  Electrical: 'Electricidad',
  HVAC: 'Climatización',
  Appliance: 'Electrodomésticos',
  'Appliance repair': 'Reparación de electrodomésticos',
  Carpentry: 'Carpintería',
  Painting: 'Pintura',
  Roofing: 'Techos',
  Flooring: 'Pisos',
  Landscaping: 'Jardinería',
  Locksmith: 'Cerrajería',
  Pest: 'Control de plagas',
  'Pest control': 'Control de plagas',
  Windows: 'Ventanas',
  General: 'General',
  Other: 'Otro',
  Maintenance: 'Mantenimiento',
}

export function translateAccessLabel(label: string, lang: JobPageLang): string {
  if (lang !== 'es') return label
  return ACCESS_LABEL_ES[label] ?? label
}

export function translateTradeLabel(label: string, lang: JobPageLang): string {
  if (lang !== 'es') return label
  return TRADE_LABEL_ES[label] ?? label
}

export function formatJobUnitLine(unitRaw: string, lang: JobPageLang): string {
  if (/^unit\b/i.test(unitRaw) || /^unidad\b/i.test(unitRaw)) return unitRaw
  return lang === 'es' ? `Unidad ${unitRaw}` : `Unit ${unitRaw}`
}

type JobPageCopy = {
  language: string
  english: string
  spanish: string
  jobDetail: string
  jobDetails: string
  maintenance: string
  noDescription: string
  tenantPhotoAlt: string
  propertyAccess: string
  access: string
  noAccessNotes: string
  jobSpecificNotes: string
  tenantContact: string
  resident: string
  call: string
  textSms: string
  noPhone: string
  appointment: string
  notScheduled: string
  vendorPrefix: string
  jobHistory: string
  noPreviousJobs: string
  unitFallback: string
  yourNextStep: string
  comingNext: string
  jobProgress: string
  residentReported: string
  progressEstimate: string
  progressStartWork: string
  progressPhotos: string
  progressInvoice: string
  acceptJob: string
  accepting: string
  acceptTitle: string
  acceptBody: string
  submitEstimate: string
  submitEstimateTitle: string
  submitEstimateBody: string
  resubmitEstimate: string
  resubmitEstimateBody: string
  waitingApprovalTitle: string
  waitingApprovalBody: string
  waitingApprovalBodyWithAmount: string
  readyToStartTitle: string
  readyToStartBody: string
  readyToStartBodyWithAmount: string
  startWork: string
  starting: string
  addPhotosTitle: string
  addPhotosBody: string
  addPhotosCta: string
  submitInvoiceTitle: string
  submitInvoiceBody: string
  submitInvoice: string
  waitingPaymentTitle: string
  waitingPaymentBody: string
  jobCompleteTitle: string
  jobCompleteBody: string
  declinedTitle: string
  declinedBody: string
  accessResidentMustBeHome: string
  accessOkIfAway: string
  retry: string
  actionFailedTitle: string
  couldntOpen: string
  loading: string
  tryAgain: string
  openFromText: string
  missingToken: string
  couldNotStartWork: string
  couldNotAcceptJob: string
  emergency: string
  statusOpen: string
  statusAwaiting: string
  statusAccepted: string
  statusInProgress: string
  statusCompleted: string
  statusDeclined: string
  statusUnassigned: string
}

export const JOB_PAGE_COPY: Record<JobPageLang, JobPageCopy> = {
  en: {
    language: 'Language',
    english: 'English',
    spanish: 'Spanish',
    jobDetail: 'Job detail',
    jobDetails: 'Job details',
    maintenance: 'Maintenance',
    noDescription: 'No description provided.',
    tenantPhotoAlt: 'Photo of the issue',
    propertyAccess: 'Property access',
    access: 'Access',
    noAccessNotes: 'No access notes provided.',
    jobSpecificNotes: 'Job-specific notes',
    tenantContact: 'Tenant contact',
    resident: 'Resident',
    call: 'Call',
    textSms: 'Text',
    noPhone: 'No phone on file',
    appointment: 'Appointment',
    notScheduled: 'Not scheduled yet',
    vendorPrefix: 'Vendor:',
    jobHistory: 'Job history at this unit',
    noPreviousJobs: 'No previous jobs for you at this unit.',
    unitFallback: 'Unit',
    yourNextStep: 'Your next step',
    comingNext: 'Coming next',
    jobProgress: 'Job progress',
    residentReported: 'Resident reported',
    progressEstimate: 'Estimate approved',
    progressStartWork: 'Start work',
    progressPhotos: 'Completion photos',
    progressInvoice: 'Submit invoice',
    acceptJob: 'Accept job',
    accepting: 'Accepting…',
    acceptTitle: 'Accept this job',
    acceptBody: 'Confirm you can take this work order, then we’ll walk you through the next steps.',
    submitEstimate: 'Submit estimate',
    submitEstimateTitle: 'Submit your estimate',
    submitEstimateBody: 'Send your parts and labor estimate so the property team can approve it.',
    resubmitEstimate: 'Submit updated estimate',
    resubmitEstimateBody: 'The property team needs an updated estimate before you continue.',
    waitingApprovalTitle: 'Waiting for approval',
    waitingApprovalBody:
      'Your estimate was sent to the property manager. We’ll let you know when it’s approved.',
    waitingApprovalBodyWithAmount:
      'Your {amount} estimate was sent to the property manager. We’ll let you know when it’s approved.',
    readyToStartTitle: 'Ready to start',
    readyToStartBody: 'Your estimate was approved. Start the repair when you’re ready.',
    readyToStartBodyWithAmount:
      'Your {amount} estimate was approved. Start the repair when you’re ready.',
    startWork: 'Start work',
    starting: 'Starting…',
    addPhotosTitle: 'Add completion photos',
    addPhotosBody: 'Upload photos or videos of the finished work before you submit an invoice.',
    addPhotosCta: 'Add photos or videos',
    submitInvoiceTitle: 'Submit invoice',
    submitInvoiceBody: 'Completion photos are in. Send your invoice for review.',
    submitInvoice: 'Submit invoice',
    waitingPaymentTitle: 'Waiting for payment',
    waitingPaymentBody:
      'Your invoice was submitted. The property team will review it and process payment.',
    jobCompleteTitle: 'Job complete',
    jobCompleteBody: 'This work order is finished. Thank you.',
    declinedTitle: 'Job declined',
    declinedBody: 'This work order was declined. No further action is needed here.',
    accessResidentMustBeHome: 'Resident must be home for entry.',
    accessOkIfAway: 'OK to enter if the resident is away.',
    retry: 'Retry',
    actionFailedTitle: 'Couldn’t update job status',
    couldntOpen: 'Couldn’t open this job',
    loading: 'Loading job…',
    tryAgain: 'Try this job link again',
    openFromText: 'Open the unique job link from your text message to continue.',
    missingToken: 'This job link is missing a token.',
    couldNotStartWork: 'Could not start work. Try again.',
    couldNotAcceptJob: 'Could not accept this job. Try again.',
    emergency: 'Emergency',
    statusOpen: 'Open',
    statusAwaiting: 'Awaiting accept',
    statusAccepted: 'Accepted',
    statusInProgress: 'In progress',
    statusCompleted: 'Completed',
    statusDeclined: 'Declined',
    statusUnassigned: 'Unassigned',
  },
  es: {
    language: 'Idioma',
    english: 'Inglés',
    spanish: 'Español',
    jobDetail: 'Detalle del trabajo',
    jobDetails: 'Detalles del trabajo',
    maintenance: 'Mantenimiento',
    noDescription: 'No hay descripción.',
    tenantPhotoAlt: 'Foto del problema',
    propertyAccess: 'Acceso a la propiedad',
    access: 'Acceso',
    noAccessNotes: 'No hay notas de acceso.',
    jobSpecificNotes: 'Notas de este trabajo',
    tenantContact: 'Contacto del inquilino',
    resident: 'Residente',
    call: 'Llamar',
    textSms: 'Mensaje',
    noPhone: 'No hay teléfono registrado',
    appointment: 'Cita',
    notScheduled: 'Aún no hay cita',
    vendorPrefix: 'Proveedor:',
    jobHistory: 'Historial en esta unidad',
    noPreviousJobs: 'No hay trabajos anteriores suyos en esta unidad.',
    unitFallback: 'Unidad',
    yourNextStep: 'Su próximo paso',
    comingNext: 'Después',
    jobProgress: 'Progreso del trabajo',
    residentReported: 'El residente reportó',
    progressEstimate: 'Presupuesto aprobado',
    progressStartWork: 'Empezar el trabajo',
    progressPhotos: 'Fotos de finalización',
    progressInvoice: 'Enviar factura',
    acceptJob: 'Aceptar el trabajo',
    accepting: 'Aceptando…',
    acceptTitle: 'Acepte este trabajo',
    acceptBody:
      'Confirme que puede tomar esta orden; luego le guiaremos en los siguientes pasos.',
    submitEstimate: 'Enviar presupuesto',
    submitEstimateTitle: 'Envíe su presupuesto',
    submitEstimateBody:
      'Envíe el presupuesto de piezas y mano de obra para que el equipo de la propiedad lo apruebe.',
    resubmitEstimate: 'Enviar presupuesto actualizado',
    resubmitEstimateBody:
      'El equipo de la propiedad necesita un presupuesto actualizado antes de continuar.',
    waitingApprovalTitle: 'Esperando aprobación',
    waitingApprovalBody:
      'Su presupuesto se envió al administrador. Le avisaremos cuando se apruebe.',
    waitingApprovalBodyWithAmount:
      'Su presupuesto de {amount} se envió al administrador. Le avisaremos cuando se apruebe.',
    readyToStartTitle: 'Listo para empezar',
    readyToStartBody:
      'Su presupuesto fue aprobado. Empiece la reparación cuando esté listo.',
    readyToStartBodyWithAmount:
      'Su presupuesto de {amount} fue aprobado. Empiece la reparación cuando esté listo.',
    startWork: 'Empezar el trabajo',
    starting: 'Empezando…',
    addPhotosTitle: 'Agregar fotos de finalización',
    addPhotosBody:
      'Suba fotos o videos del trabajo terminado antes de enviar la factura.',
    addPhotosCta: 'Agregar fotos o videos',
    submitInvoiceTitle: 'Enviar factura',
    submitInvoiceBody: 'Las fotos ya están. Envíe su factura para revisión.',
    submitInvoice: 'Enviar factura',
    waitingPaymentTitle: 'Esperando el pago',
    waitingPaymentBody:
      'Su factura fue enviada. El equipo de la propiedad la revisará y procesará el pago.',
    jobCompleteTitle: 'Trabajo completo',
    jobCompleteBody: 'Esta orden de trabajo está terminada. Gracias.',
    declinedTitle: 'Trabajo rechazado',
    declinedBody: 'Rechazó esta orden. No hay más acciones aquí.',
    accessResidentMustBeHome: 'El residente debe estar en casa para entrar.',
    accessOkIfAway: 'Se puede entrar si el residente no está.',
    retry: 'Reintentar',
    actionFailedTitle: 'No se pudo actualizar el estado',
    couldntOpen: 'No se pudo abrir este trabajo',
    loading: 'Cargando el trabajo…',
    tryAgain: 'Volver a abrir este enlace',
    openFromText: 'Abra el enlace único del mensaje de texto para continuar.',
    missingToken: 'Falta el código de este enlace de trabajo.',
    couldNotStartWork: 'No se pudo empezar el trabajo. Inténtelo de nuevo.',
    couldNotAcceptJob: 'No se pudo aceptar el trabajo. Inténtelo de nuevo.',
    emergency: 'Emergencia',
    statusOpen: 'Abierto',
    statusAwaiting: 'Pendiente de aceptar',
    statusAccepted: 'Aceptado',
    statusInProgress: 'En curso',
    statusCompleted: 'Completado',
    statusDeclined: 'Rechazado',
    statusUnassigned: 'Sin asignar',
  },
}

export type JobPageCopyBundle = JobPageCopy

export function jobPageCopy(lang: JobPageLang): JobPageCopy {
  return JOB_PAGE_COPY[lang]
}

export function withAmount(template: string, amount: string | null): string {
  if (!amount) return template.replace(/\s*\{amount\}\s*/g, ' ').replace(/\s+/g, ' ').trim()
  return template.replace('{amount}', amount)
}

export function jobStatusLabel(
  status: string | null | undefined,
  copy: JobPageCopy,
): string {
  if (status == null) return copy.statusOpen
  const s = String(status).toLowerCase()
  if (s === 'pending_accept') return copy.statusAwaiting
  if (s === 'accepted') return copy.statusAccepted
  if (s === 'in_progress') return copy.statusInProgress
  if (s === 'completed') return copy.statusCompleted
  if (s === 'declined') return copy.statusDeclined
  if (s === 'unassigned') return copy.statusUnassigned
  return String(status).replace(/_/g, ' ')
}

export function jobHeaderBadge(
  priority: string | null | undefined,
  status: string | null | undefined,
  copy: JobPageCopy,
): { label: string; className: string; emergency: boolean } {
  const p = (priority ?? '').trim().toLowerCase()
  if (p === 'emergency' || p === 'urgent' || p === 'critical') {
    return {
      label: copy.emergency,
      className: 'bg-[#fbe3e5] text-[#da4951]',
      emergency: true,
    }
  }
  return {
    label: jobStatusLabel(status, copy),
    className: 'bg-[#eef6f8] text-[#186179]',
    emergency: false,
  }
}

export function progressLabel(
  id: 'estimate' | 'start_work' | 'photos' | 'invoice',
  copy: JobPageCopy,
): string {
  if (id === 'estimate') return copy.progressEstimate
  if (id === 'start_work') return copy.progressStartWork
  if (id === 'photos') return copy.progressPhotos
  return copy.progressInvoice
}
