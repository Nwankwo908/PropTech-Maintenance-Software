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
  description: string
  maintenance: string
  noDescription: string
  tenantPhotoAlt: string
  propertyAccess: string
  noAccessNotes: string
  jobSpecificNotes: string
  tenantContact: string
  noPhone: string
  appointment: string
  notScheduled: string
  vendorPrefix: string
  jobHistory: string
  noPreviousJobs: string
  unitFallback: string
  nextSteps: string
  submitEstimate: string
  estimateSubmitted: string
  startWork: string
  starting: string
  workStarted: string
  startWorkTitle: string
  startWorkLockedTitle: string
  workStartedTitle: string
  uploadPhotos: string
  submitInvoice: string
  afterEstimateApproved: string
  afterUploadPhotos: string
  couldntOpen: string
  loading: string
  tryAgain: string
  openFromText: string
  missingToken: string
  couldNotStartWork: string
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
    description: 'Description',
    maintenance: 'Maintenance',
    noDescription: 'No description provided.',
    tenantPhotoAlt: 'Tenant photo for this work order',
    propertyAccess: 'Property access',
    noAccessNotes: 'No access notes provided.',
    jobSpecificNotes: 'Job-specific notes',
    tenantContact: 'Tenant contact',
    noPhone: 'No phone on file',
    appointment: 'Appointment',
    notScheduled: 'Not scheduled yet',
    vendorPrefix: 'Vendor:',
    jobHistory: 'Property job history',
    noPreviousJobs: 'No previous jobs at this property.',
    unitFallback: 'Unit',
    nextSteps: 'Next Steps',
    submitEstimate: 'Submit estimate',
    estimateSubmitted: 'Estimate submitted',
    startWork: 'Start work',
    starting: 'Starting…',
    workStarted: 'Work started',
    startWorkTitle: 'Mark this job as in progress',
    startWorkLockedTitle: 'Available after you accept this job',
    workStartedTitle: 'Open this work order in the vendor portal',
    uploadPhotos: 'Upload photos or videos',
    submitInvoice: 'Submit invoice',
    afterEstimateApproved: 'Available after your estimate is approved',
    afterUploadPhotos: 'Available after you upload completion photos',
    couldntOpen: 'Couldn’t open this job',
    loading: 'Loading job…',
    tryAgain: 'Try this job link again',
    openFromText: 'Open the unique job link from your text message to continue.',
    missingToken: 'This job link is missing a token.',
    couldNotStartWork: 'Could not start work. Try again.',
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
    description: 'Descripción',
    maintenance: 'Mantenimiento',
    noDescription: 'No hay descripción.',
    tenantPhotoAlt: 'Foto del inquilino para esta orden de trabajo',
    propertyAccess: 'Acceso a la propiedad',
    noAccessNotes: 'No hay notas de acceso.',
    jobSpecificNotes: 'Notas de este trabajo',
    tenantContact: 'Contacto del inquilino',
    noPhone: 'No hay teléfono registrado',
    appointment: 'Cita',
    notScheduled: 'Aún no hay cita',
    vendorPrefix: 'Proveedor:',
    jobHistory: 'Historial de trabajos',
    noPreviousJobs: 'No hay trabajos anteriores en esta propiedad.',
    unitFallback: 'Unidad',
    nextSteps: 'Próximos pasos',
    submitEstimate: 'Enviar presupuesto',
    estimateSubmitted: 'Presupuesto enviado',
    startWork: 'Empezar el trabajo',
    starting: 'Empezando…',
    workStarted: 'Trabajo iniciado',
    startWorkTitle: 'Marcar este trabajo como en curso',
    startWorkLockedTitle: 'Disponible cuando acepte este trabajo',
    workStartedTitle: 'Abrir este trabajo en el portal de proveedores',
    uploadPhotos: 'Subir fotos o videos',
    submitInvoice: 'Enviar factura',
    afterEstimateApproved: 'Disponible cuando se apruebe el presupuesto',
    afterUploadPhotos: 'Disponible después de subir las fotos',
    couldntOpen: 'No se pudo abrir este trabajo',
    loading: 'Cargando el trabajo…',
    tryAgain: 'Volver a abrir este enlace',
    openFromText: 'Abra el enlace único del mensaje de texto para continuar.',
    missingToken: 'Falta el código de este enlace de trabajo.',
    couldNotStartWork: 'No se pudo empezar el trabajo. Inténtelo de nuevo.',
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
): { label: string; className: string } {
  const p = (priority ?? '').trim().toLowerCase()
  if (p === 'emergency' || p === 'urgent' || p === 'critical') {
    return { label: copy.emergency, className: 'bg-[#fbe3e5] text-[#da4951]' }
  }
  return {
    label: jobStatusLabel(status, copy),
    className: 'bg-[#eef6f8] text-[#186179]',
  }
}
