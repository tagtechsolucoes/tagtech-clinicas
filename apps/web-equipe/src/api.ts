import type {
  PayMethod,
  AppointmentStatus,
  BrandTheme,
  ClinicRole,
  RecordKind,
  ToothState,
} from '@tagtech/domain';

export interface Membership {
  tenantId: string;
  tenantName: string;
  role: ClinicRole;
  unitId: string | null;
}

export interface Me {
  userId: string;
  name: string;
  email: string;
  memberships: Membership[];
}

export interface Unit {
  id: string;
  name: string;
  timezone: string;
  address: string;
  phone: string;
  active: boolean;
}

export interface Clinic {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  about: string;
  whatsapp: string;
  instagram: string;
  logoUrl: string | null;
  coverUrl: string | null;
  theme: BrandTheme;
  booking: {
    enabled: boolean;
    minNoticeMinutes: number;
    horizonDays: number;
    slotStepMinutes: number;
  };
  units: Unit[];
  legalName: string;
  document: string;
  insuranceEnabled: boolean;
}

export interface WorkHours {
  unitId: string;
  weekday: number;
  start: number;
  end: number;
}

export interface Professional {
  id: string;
  name: string;
  specialty: string;
  council: string;
  bio: string;
  photoUrl: string | null;
  color: string;
  onlineBooking: boolean;
  active: boolean;
  membershipId: string | null;
  recordKind: RecordKind;
  hours: WorkHours[];
  serviceIds: string[];
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  durationMinutes: number;
  priceCents: number | null;
  returnDays?: number | null;
  color: string;
  onlineBooking: boolean;
  active: boolean;
  professionalIds: string[];
}

export interface Room {
  id: string;
  unitId: string;
  name: string;
  active: boolean;
}

export interface PatientSummary {
  id: string;
  name: string;
  phone: string;
  email: string;
  birthDate: string | null;
  hasAlerts: boolean;
}

export interface Patient extends PatientSummary {
  cpf: string | null;
  allergies: string;
  medications: string;
  notes: string;
  source: 'staff' | 'online' | 'import';
  consentAt: string | null;
  contactErasedAt?: string | null;
  createdAt: string;
  appointments?: Array<{
    id: string;
    startsAt: string;
    status: AppointmentStatus;
    serviceName: string;
    professionalName: string;
  }>;
}

export interface Appointment {
  id: string;
  unitId: string;
  roomId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: 'staff' | 'online';
  priceCents: number | null;
  insurerId: string | null;
  authorizationId: string | null;
  copayCents: number | null;
  packageId?: string | null;
  seriesId?: string | null;
  notes: string;
  cancelReason: string | null;
  confirmedAt: string | null;
  service: { id: string; name: string; color: string };
  professional: { id: string; name: string; color: string };
  patient: PatientSummary;
  manageToken?: string;
}

export interface TimeOff {
  id: string;
  professionalId: string | null;
  unitId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface Slots {
  professionalId: string;
  unitId: string;
  timezone: string;
  times: string[];
}

export interface HistoryEvent {
  from: AppointmentStatus | null;
  to: AppointmentStatus;
  fromStartsAt: string | null;
  reason: string | null;
  actor: string;
  at: string;
}

export interface WaitlistEntry {
  id: string;
  status: 'waiting' | 'offered' | 'booked' | 'cancelled';
  serviceId: string;
  serviceName: string;
  professionalId: string | null;
  unitId: string | null;
  fromDate: string;
  toDate: string;
  period: 'any' | 'morning' | 'afternoon' | 'evening';
  notes: string;
  patient: PatientSummary;
  createdAt: string;
}

export interface TeamMember {
  membershipId: string;
  name: string;
  email: string;
  role: ClinicRole;
  unitId: string | null;
  joinedAt: string;
  isYou: boolean;
}

export interface Invite {
  id: string;
  name: string;
  role: ClinicRole;
  createdAt: string;
  expiresAt: string;
  token?: string;
}

export interface WhatsAppSettings {
  configured: boolean;
  enabled: boolean;
  phoneNumberId: string;
  displayPhone: string;
  templateName: string;
  templateLang: string;
  reminderHours: number;
}

export interface SentMessage {
  event: 'booked' | 'reminder' | 'rescheduled' | 'cancelled';
  status: 'sending' | 'sent' | 'failed';
  error: string | null;
  at: string;
}

export interface ClinicalNote {
  id: string;
  kind: RecordKind;
  appointmentId: string | null;
  professionalName: string | null;
  author: string;
  mine: boolean;
  private: boolean;
  hidden: boolean;
  data: Record<string, string | number>;
  text: string;
  locked: boolean;
  addendumOf: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tooth {
  tooth: number;
  state: ToothState;
  note: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  stage: 'before' | 'during' | 'after';
  region: string;
  angle: string;
  takenOn: string;
  note: string;
  appointmentId: string | null;
  createdAt: string;
}

export interface ImageConsent {
  active: boolean;
  id?: string;
  scope?: 'site' | 'social' | 'both';
  signedOn?: string;
  termText: string;
}

export interface GalleryItem {
  id: string;
  title: string;
  serviceId: string | null;
  beforeUrl: string;
  afterUrl: string;
  patientId: string;
  patientName: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** A clínica escolhida vai em todas as chamadas (quem trabalha em duas escolhe uma). */
let currentTenant: string | null = null;
export const setTenant = (id: string | null) => {
  currentTenant = id;
};

async function request<T>(
  path: string,
  init: RequestInit & { contentType?: string } = {},
): Promise<T> {
  const { contentType, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      headers: {
        ...(contentType
          ? { 'content-type': contentType }
          : rest.body
            ? { 'content-type': 'application/json' }
            : {}),
        ...(currentTenant ? { 'x-tenant-id': currentTenant } : {}),
      },
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0);
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const b = (body ?? {}) as {
      message?: unknown;
      reason?: unknown;
      fields?: Array<{ message: string }>;
    };
    const message =
      b.fields?.[0]?.message ??
      (typeof b.message === 'string' ? b.message : 'Não foi possível concluir. Tente de novo.');
    if (response.status === 413) throw new ApiError('A imagem passa de 8 MB. Use uma menor.', 413);
    if (response.status === 415) throw new ApiError('Use uma imagem JPEG, PNG ou WebP.', 415);
    throw new ApiError(
      message,
      response.status,
      typeof b.reason === 'string' ? b.reason : undefined,
    );
  }
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

const ACEITAS = ['image/jpeg', 'image/png', 'image/webp'];
const LIMITE_SEM_REDUZIR = 2 * 1024 * 1024;
const LADO_MAXIMO = 2400;

/** Reduz foto grande no próprio navegador antes de enviar (a API reprocessa de todo jeito). */
async function prepararImagem(file: File): Promise<Blob> {
  if (ACEITAS.includes(file.type) && file.size <= LIMITE_SEM_REDUZIR) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ApiError('Não foi possível ler esta imagem. Use uma foto em JPEG, PNG ou WebP.', 400);
  }
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  if (!blob) throw new ApiError('Não foi possível preparar a imagem.', 400);
  return blob;
}

const imagem = async <T>(path: string, file: File) => {
  const corpo = await prepararImagem(file);
  return request<T>(path, { method: 'PUT', body: corpo, contentType: corpo.type });
};

export interface PlanItem {
  id?: string;
  serviceId?: string | undefined;
  description: string;
  tooth?: number | null;
  quantity: number;
  unitPriceCents: number;
  appointmentId?: string | null;
}

export type PlanStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'cancelled';

export interface Charge {
  id: string;
  patientId: string | null;
  patientName: string | null;
  planId: string | null;
  appointmentId: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  installment: number;
  installments: number;
  isDeposit: boolean;
  status: 'open' | 'paid' | 'cancelled';
  method: PayMethod | null;
  paidAt: string | null;
}

export interface Plan {
  id: string;
  patientId: string;
  professionalId: string | null;
  professionalName: string | null;
  title: string;
  status: PlanStatus;
  discountCents: number;
  cashDiscountPct: number;
  maxInstallments: number;
  notes: string;
  validUntil: string | null;
  chosenInstallments: number | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  subtotal: number;
  total: number;
  cashTotal: number;
  items: PlanItem[];
  charges?: Charge[];
}

export interface PlanInput {
  title: string;
  professionalId: string | null;
  discountCents: number;
  cashDiscountPct: number;
  maxInstallments: number;
  notes: string;
  validUntil: string | null;
  items: PlanItem[];
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  supplier: string;
  amountCents: number;
  dueDate: string;
  status: 'open' | 'paid' | 'cancelled';
  method: PayMethod | null;
  paidAt: string | null;
}

export interface Pix {
  id: string;
  status: 'pending' | 'approved' | 'cancelled' | 'expired';
  amountCents: number;
  pixCode: string;
  qrBase64: string;
  expiresAt: string;
  test: boolean;
}

export interface FinanceSummary {
  month: string;
  receivedCents: number;
  toReceiveCents: number;
  overdueCents: number;
  paidCents: number;
  toPayCents: number;
  resultCents: number;
  byMethod: Partial<Record<PayMethod, number>>;
  byCategory: Record<string, number>;
}

export interface Cashbox {
  day: string;
  totalCents: number;
  byMethod: Partial<Record<PayMethod, number>>;
  items: Charge[];
}

export interface PixSettings {
  configured: boolean;
  depositCents: number;
  testMode: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  whatsapp: string;
  email: string;
  leadTimeDays: number;
  notes: string;
  active: boolean;
  prices?: Array<{
    itemId: string;
    itemName: string;
    purchaseUnit: string;
    lastPriceCents: number;
    previousPriceCents: number | null;
    updatedAt: string;
  }>;
}

export interface StockItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  purchaseUnit: string;
  unitsPerPurchase: number;
  costCents: number;
  minQty: number;
  supplierId: string | null;
  supplierName: string | null;
  openValidityDays: number | null;
  active: boolean;
  qty: number;
  valueCents: number;
  scheduled30: number;
  used30: number;
  daysLeft: number | null;
  shortage: { appointmentId: string; startsAt: string; missing: number } | null;
  expiring: Array<{
    lotId: string;
    lot: string;
    expiresOn: string;
    qty: number;
    expired: boolean;
    opened?: boolean;
  }>;
  idle: boolean;
  onOrder: number;
  lastUsedAt: string | null;
}

export interface StockMove {
  id: string;
  kind: 'purchase' | 'consume' | 'return' | 'loss' | 'expired' | 'manual' | 'adjust';
  qty: number;
  costCents: number;
  reason: string;
  lot: string | null;
  expiresOn: string | null;
  appointmentId: string | null;
  purchaseId: string | null;
  patientName: string | null;
  createdAt: string;
}

export interface StockLot {
  id: string;
  lot: string;
  expiresOn: string | null;
  qty: number;
  costCents: number;
  openedAt: string | null;
}

export interface ShoppingGroup {
  supplier: Supplier | null;
  totalCents: number;
  items: Array<{
    itemId: string;
    name: string;
    purchaseUnit: string;
    unitsPerPurchase: number;
    unit: string;
    qty: number;
    reasons: Array<'agenda' | 'minimum' | 'ending' | 'expiring'>;
    shortage: { appointmentId: string; startsAt: string; missing: number } | null;
    suggestedQty: number;
    priceCents: number;
    supplierId: string | null;
  }>;
}

export interface StockReport {
  month: string;
  purchasesCents: number;
  bySupplier: Array<{ supplierId: string | null; name: string; totalCents: number }>;
  byProcedure: Array<{ serviceId: string; name: string; costCents: number }>;
  lossesCents: number;
  procedureMargins: Array<{
    serviceId: string;
    name: string;
    priceCents: number | null;
    materialCents: number;
    marginCents: number | null;
  }>;
  priceIncreases: Array<{ name: string; supplier: string; fromCents: number; toCents: number }>;
}

export interface AppointmentMaterial {
  id: string;
  itemId: string;
  name: string;
  unit: string;
  kind: string;
  qty: number;
  lot: string | null;
  expiresOn: string | null;
  createdAt: string;
}

export interface Results {
  month: string;
  generatedCents: number;
  parts: {
    waitlist: { count: number; valueCents: number };
    online: { count: number; valueCents: number };
    plans: { count: number; sent: number; valueCents: number };
    recalls: { count: number; sent: number; valueCents: number };
  };
  agenda: {
    total: number;
    done: number;
    noShows: number;
    cancelled: number;
    noShowRate: number | null;
    confirmed: number;
    confirmedByPatient: number;
  };
  whatsappSent: number;
  reviews: {
    requested: number;
    answered: number;
    average: number | null;
    toGoogle: number;
    low: number;
  };
  deposits: { count: number; valueCents: number };
  previous: { noShowRate: number | null; generatedCents: number };
}

export interface Insurer {
  id: string;
  name: string;
  ansCode: string;
  providerCode: string;
  paymentDays: number;
  showOnSite: boolean;
  active: boolean;
  prices: Array<{
    serviceId: string;
    priceCents: number;
    copayCents: number;
    tussCode: string;
    needsAuthorization: boolean;
  }>;
  professionalIds: string[];
}

export interface PatientInsurance {
  cards: Array<{
    insurerId: string;
    insurerName: string;
    cardNumber: string;
    planName: string;
    validUntil: string | null;
  }>;
  authorizations: Array<{
    id: string;
    insurerId: string;
    insurerName: string;
    serviceId: string;
    serviceName: string;
    guideNumber: string;
    password: string;
    validUntil: string | null;
    sessions: number;
    used: number;
  }>;
}

export interface Billing {
  competence: string;
  pending: Array<{ insurerId: string; insurerName: string; count: number; totalCents: number }>;
  batches: Array<{
    id: string;
    insurerId: string;
    insurerName: string;
    number: number;
    status: 'open' | 'sent' | 'paid';
    sentAt: string | null;
    paidAt: string | null;
    count: number;
    billedCents: number;
    paidCents: number | null;
    glosaCents: number | null;
  }>;
}

export interface Batch {
  id: string;
  insurerId: string;
  insurerName: string;
  number: number;
  competence: string;
  status: 'open' | 'sent' | 'paid';
  sentAt: string | null;
  paidAt: string | null;
  billedCents: number;
  claims: Array<{
    id: string;
    appointmentId: string;
    date: string;
    patientName: string;
    cardNumber: string;
    serviceName: string;
    professionalName: string;
    guideNumber: string | null;
    tussCode: string;
    billedCents: number;
    paidCents: number | null;
    glosaReason: string;
  }>;
}

export interface FiscalSettings {
  configured: boolean;
  environment?: 'homologacao' | 'producao';
  standard?: 'nacional' | 'municipal';
  cnpj?: string;
  municipalRegistration?: string;
  cityCode?: string;
  serviceCode?: string;
  municipalServiceCode?: string;
  issRate?: number;
  simplesOption?: number;
  description?: string;
  autoEmit?: boolean;
}

export interface ServiceInvoice {
  id: string;
  chargeId: string;
  environment: string;
  status: 'emitting' | 'authorized' | 'error' | 'cancelled';
  amountCents: number;
  number: string | null;
  url: string | null;
  message: string | null;
  createdAt: string;
}

export interface Receipt {
  number: string;
  clinic: { name: string; legalName: string; document: string; address: string; phone: string };
  patient: { name: string; cpf: string | null } | null;
  description: string;
  amountCents: number;
  method: string;
  paidAt: string;
  appointment: {
    date: string;
    serviceName: string;
    professionalName: string;
    council: string;
  } | null;
}

export interface RelationshipSettings {
  waitlistAutoOffer: boolean;
  reactivationDays: number;
  googleReviewUrl: string;
}

export interface Review {
  id: string;
  patientId: string;
  patientName: string;
  appointmentStartsAt: string;
  rating: number;
  comment: string;
  sentToGoogle: boolean;
  answeredAt: string;
}

export interface SessionPackage {
  id: string;
  patientId: string;
  serviceId: string;
  serviceName: string;
  title: string;
  totalSessions: number;
  used: number;
  booked: number;
  remaining: number;
  free: number;
  endingSoon: boolean;
  priceCents: number;
  noShowCounts: boolean;
  validUntil: string | null;
  status: 'active' | 'finished' | 'cancelled';
  notes: string;
  createdAt: string;
}

export type DocumentKind = 'prescription' | 'certificate' | 'declaration' | 'exam_request';
export interface ClinicalDocument {
  id: string;
  kind: DocumentKind;
  patientId: string;
  appointmentId: string | null;
  professional: { id: string; name: string; council: string; specialty: string };
  content: Record<string, unknown>;
  createdAt: string;
}
export interface PrintableDocument extends ClinicalDocument {
  patient: { name: string; cpf: string | null; birthDate: string | null };
  clinic: {
    name: string;
    legalName: string;
    document: string;
    logoUrl: string | null;
    primaryColor: string;
    address: string;
    phone: string;
    city: string;
    timezone: string;
  };
}
export interface Payout {
  professionalId: string;
  name: string;
  commissionPct: number;
  appointments: number;
  producedCents: number;
  payoutCents: number;
  lines: Array<{
    appointmentId: string;
    date: string;
    serviceName: string;
    baseCents: number;
    insurance: boolean;
    commissionCents: number;
  }>;
}
export interface Overview {
  month: string;
  totals: {
    appointments: number;
    done: number;
    noShows: number;
    revenueCents: number;
    noShowRate: number | null;
  };
  professionals: Array<{
    professionalId: string;
    name: string;
    appointments: number;
    done: number;
    noShows: number;
    noShowRate: number | null;
    occupancy: number | null;
    revenueCents: number;
  }>;
  plans: { sent: number; approved: number; declined: number; open: number; approvedCents: number };
}
export interface CommissionSetting {
  professionalId: string;
  name: string;
  commissionPct: number;
  rules: Array<{ serviceId: string; pct: number | null; fixedCents: number | null }>;
}
export interface QueueItem {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  patientId: string;
  patientName: string;
  serviceName: string;
  professionalName: string;
  roomName: string | null;
  arrivedAt: string | null;
  lastCalledAt: string | null;
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === '' ? [] : [[k, String(v)]],
    ),
  ).toString();

export const api = {
  // conta
  me: () => request<Me>('/auth/me'),
  login: (email: string, password: string) => send<Me>('POST', '/auth/login', { email, password }),
  signup: (data: { name: string; email: string; password: string; clinicName: string }) =>
    send<Me>('POST', '/auth/signup', data),
  logout: () => send<void>('POST', '/auth/logout'),
  forgot: (email: string) => send<void>('POST', '/auth/forgot-password', { email }),
  resetInfo: (token: string) => request<{ email: string }>(`/auth/reset-password/${token}`),
  reset: (token: string, password: string) =>
    send<Me>('POST', `/auth/reset-password/${token}`, { password }),
  invite: (token: string) =>
    request<{ clinicName: string; unitName: string | null; role: ClinicRole; name: string }>(
      `/invites/${token}`,
    ),
  acceptInvite: (token: string, data: { name: string; email: string; password: string }) =>
    send<Me>('POST', `/invites/${token}/accept`, data),
  joinInvite: (token: string) => send<void>('POST', `/invites/${token}/join`),

  // clínica
  clinic: () => request<Clinic>('/clinic'),
  updateClinic: (patch: Record<string, unknown>) => send<Clinic>('PATCH', '/clinic', patch),
  setLogo: (file: File) => imagem<Clinic>('/clinic/logo', file),
  removeLogo: () => send<Clinic>('DELETE', '/clinic/logo'),
  setCover: (file: File) => imagem<Clinic>('/clinic/cover', file),
  removeCover: () => send<Clinic>('DELETE', '/clinic/cover'),
  updateUnit: (id: string, patch: Partial<Omit<Unit, 'id'>>) =>
    send<Unit>('PATCH', `/units/${id}`, patch),
  rooms: () => request<Room[]>('/rooms'),
  createRoom: (unitId: string, name: string) => send<Room>('POST', '/rooms', { unitId, name }),
  updateRoom: (id: string, patch: { name?: string; active?: boolean }) =>
    send<Room>('PATCH', `/rooms/${id}`, patch),

  professionals: () => request<Professional[]>('/professionals'),
  createProfessional: (data: Partial<Professional> & { name: string }) =>
    send<Professional>('POST', '/professionals', data),
  updateProfessional: (id: string, patch: Partial<Professional>) =>
    send<Professional>('PATCH', `/professionals/${id}`, patch),
  setHours: (id: string, hours: WorkHours[]) =>
    send<Professional>('PUT', `/professionals/${id}/hours`, hours),
  setPhoto: (id: string, file: File) => imagem<Professional>(`/professionals/${id}/photo`, file),
  removePhoto: (id: string) => send<Professional>('DELETE', `/professionals/${id}/photo`),

  services: () => request<Service[]>('/services'),
  createService: (data: Partial<Service> & { name: string; durationMinutes: number }) =>
    send<Service>('POST', '/services', data),
  updateService: (id: string, patch: Partial<Service>) =>
    send<Service>('PATCH', `/services/${id}`, patch),

  createTimeOff: (data: {
    professionalId: string | null;
    unitId: string | null;
    startsAt: string;
    endsAt: string;
    reason: string;
  }) => send<TimeOff>('POST', '/time-off', data),
  deleteTimeOff: (id: string) => send<void>('DELETE', `/time-off/${id}`),

  // agenda
  agenda: (from: string, to: string, unitId?: string) =>
    request<{ appointments: Appointment[]; timeOff: TimeOff[] }>(
      `/agenda?${qs({ from, to, unitId })}`,
    ),
  slots: (q: { serviceId: string; date: string; professionalId?: string; unitId?: string }) =>
    request<Slots[]>(`/agenda/slots?${qs(q)}`),
  book: (data: {
    patientId?: string;
    patient?: { name: string; phone: string };
    serviceId: string;
    professionalId: string;
    unitId?: string;
    roomId?: string | null;
    startsAt: string;
    notes?: string;
    priceCents?: number | null;
    allowOutsideHours?: boolean;
    packageId?: string;
    repeat?: { everyWeeks: number; count: number };
  }) =>
    send<
      Appointment & {
        series?: {
          id: string;
          created: number;
          skipped: Array<{ startsAt: string; reason: string }>;
        };
      }
    >('POST', '/appointments', data),
  cancelSeries: (id: string, reason: string) =>
    send<{ cancelled: number }>('POST', `/appointments/${id}/cancel-series`, { reason }),
  packages: (patientId: string) => request<SessionPackage[]>(`/patients/${patientId}/packages`),
  createPackage: (
    patientId: string,
    data: {
      serviceId: string;
      title?: string;
      totalSessions: number;
      priceCents: number;
      noShowCounts: boolean;
      validUntil?: string | null;
      notes?: string;
      charge?: { installments: number };
    },
  ) => send<SessionPackage>('POST', `/patients/${patientId}/packages`, data),
  cancelPackage: (id: string) => send<SessionPackage>('POST', `/packages/${id}/cancel`),
  updateAppointment: (
    id: string,
    patch: {
      startsAt?: string;
      professionalId?: string;
      roomId?: string | null;
      notes?: string;
      priceCents?: number | null;
      allowOutsideHours?: boolean;
    },
  ) => send<Appointment>('PATCH', `/appointments/${id}`, patch),
  setStatus: (id: string, status: AppointmentStatus, reason?: string) =>
    send<Appointment>('POST', `/appointments/${id}/status`, {
      status,
      ...(reason ? { reason } : {}),
    }),
  manageLink: (id: string) => send<{ token: string }>('POST', `/appointments/${id}/link`),
  history: (id: string) => request<HistoryEvent[]>(`/appointments/${id}/history`),
  waitlistMatches: (id: string) => request<WaitlistEntry[]>(`/appointments/${id}/waitlist`),

  waitlist: () => request<WaitlistEntry[]>('/waitlist'),
  addToWaitlist: (data: {
    patientId: string;
    serviceId: string;
    professionalId: string | null;
    fromDate: string;
    toDate: string;
    period: WaitlistEntry['period'];
    notes: string;
  }) => send<WaitlistEntry>('POST', '/waitlist', data),
  setWaitlistStatus: (id: string, status: WaitlistEntry['status']) =>
    send<unknown>('PATCH', `/waitlist/${id}`, { status }),

  // pacientes
  patients: (q = '', limit = 30) => request<PatientSummary[]>(`/patients?${qs({ q, limit })}`),
  patient: (id: string) => request<Patient>(`/patients/${id}`),
  createPatient: (data: Partial<Patient> & { name: string }) =>
    send<Patient>('POST', '/patients', data),
  updatePatient: (id: string, patch: Partial<Patient>) =>
    send<Patient>('PATCH', `/patients/${id}`, patch),
  importPatients: (rows: Array<Record<string, string>>) =>
    send<{ created: number; skipped: Array<{ line: number; name: string; reason: string }> }>(
      'POST',
      '/patients/import',
      { rows },
    ),

  // WhatsApp
  whatsapp: () => request<WhatsAppSettings>('/whatsapp'),
  saveWhatsapp: (data: {
    phoneNumberId: string;
    accessToken?: string;
    templateName: string;
    templateLang: string;
    reminderHours: number;
    enabled: boolean;
  }) => send<WhatsAppSettings>('PUT', '/whatsapp', data),
  toggleWhatsapp: (enabled: boolean) => send<WhatsAppSettings>('PATCH', '/whatsapp', { enabled }),
  removeWhatsapp: () => send<WhatsAppSettings>('DELETE', '/whatsapp'),
  testWhatsapp: (phone: string) => send<{ sent: true }>('POST', '/whatsapp/test', { phone }),
  messages: (appointmentId: string) =>
    request<SentMessage[]>(`/appointments/${appointmentId}/messages`),

  // prontuário
  notes: (patientId: string) => request<ClinicalNote[]>(`/patients/${patientId}/notes`),
  createNote: (
    patientId: string,
    data: {
      kind: RecordKind;
      data: Record<string, unknown>;
      text: string;
      private?: boolean;
      addendumOf?: string;
      appointmentId?: string;
    },
  ) => send<ClinicalNote>('POST', `/patients/${patientId}/notes`, data),
  updateNote: (
    id: string,
    patch: { data?: Record<string, unknown>; text?: string; private?: boolean },
  ) => send<ClinicalNote>('PATCH', `/notes/${id}`, patch),
  lockNote: (id: string) => send<ClinicalNote>('POST', `/notes/${id}/lock`),
  teeth: (patientId: string) => request<Tooth[]>(`/patients/${patientId}/teeth`),
  setTooth: (patientId: string, tooth: number, state: ToothState | null, note = '') =>
    send<unknown>('PUT', `/patients/${patientId}/teeth/${tooth}`, { state, note }),
  photos: (patientId: string) => request<Photo[]>(`/patients/${patientId}/photos`),
  addPhoto: async (
    patientId: string,
    file: File,
    meta: { stage: Photo['stage']; region: string; angle: string; takenOn: string },
  ) => {
    const corpo = await prepararImagem(file);
    return request<Photo>(`/patients/${patientId}/photos?${qs(meta)}`, {
      method: 'PUT',
      body: corpo,
      contentType: corpo.type,
    });
  },
  updatePhoto: (
    id: string,
    patch: Partial<Pick<Photo, 'stage' | 'region' | 'angle' | 'takenOn' | 'note'>>,
  ) => send<Photo>('PATCH', `/photos/${id}`, patch),
  deletePhoto: (id: string) => send<void>('DELETE', `/photos/${id}`),
  imageConsent: (patientId: string) =>
    request<ImageConsent>(`/patients/${patientId}/image-consent`),
  recordConsent: (
    patientId: string,
    data: { scope: 'site' | 'social' | 'both'; signedOn: string; termText?: string },
  ) => send<ImageConsent>('POST', `/patients/${patientId}/image-consent`, data),
  revokeConsent: (patientId: string) =>
    send<ImageConsent>('DELETE', `/patients/${patientId}/image-consent`),
  gallery: () => request<GalleryItem[]>('/gallery'),
  publish: (data: {
    beforePhotoId: string;
    afterPhotoId: string;
    title: string;
    serviceId?: string;
  }) => send<GalleryItem>('POST', '/gallery', data),
  unpublish: (id: string) => send<void>('DELETE', `/gallery/${id}`),

  // orçamentos
  plans: (patientId: string) => request<Plan[]>(`/patients/${patientId}/plans`),
  plan: (id: string) => request<Plan>(`/plans/${id}`),
  createPlan: (patientId: string, data: PlanInput) =>
    send<Plan>('POST', `/patients/${patientId}/plans`, data),
  updatePlan: (id: string, data: PlanInput) => send<Plan>('PUT', `/plans/${id}`, data),
  sendPlan: (id: string) =>
    send<{ token: string; plan: Plan; patientPhone: string }>('POST', `/plans/${id}/send`),
  approvePlan: (id: string, installments: number, firstDueDate?: string) =>
    send<Plan>('POST', `/plans/${id}/approve`, {
      installments,
      ...(firstDueDate ? { firstDueDate } : {}),
    }),
  declinePlan: (id: string) => send<Plan>('POST', `/plans/${id}/decline`),
  cancelPlan: (id: string) => send<Plan>('POST', `/plans/${id}/cancel`),

  // financeiro
  charges: (q: { status?: string; from?: string; to?: string; patientId?: string } = {}) =>
    request<Charge[]>(`/finance/charges?${qs(q)}`),
  createCharge: (data: {
    patientId?: string;
    description: string;
    amountCents: number;
    dueDate: string;
  }) => send<Charge>('POST', '/finance/charges', data),
  payCharge: (id: string, method: PayMethod) =>
    send<Charge>('POST', `/finance/charges/${id}/pay`, { method }),
  cancelCharge: (id: string) => send<Charge>('POST', `/finance/charges/${id}/cancel`),
  reopenCharge: (id: string) => send<Charge>('POST', `/finance/charges/${id}/reopen`),
  chargePix: (id: string) => send<Pix>('POST', `/finance/charges/${id}/pix`),
  pixStatus: (id: string) => request<{ status: Pix['status'] }>(`/public/pix/${id}`),
  fakeApprovePix: (id: string) =>
    send<{ status: string }>('POST', `/public/pix/${id}/fake-approve`),
  cashbox: (day: string) => request<Cashbox>(`/finance/cashbox?day=${day}`),
  expenses: (from: string, to: string) =>
    request<Expense[]>(`/finance/expenses?${qs({ from, to })}`),
  createExpense: (data: {
    description: string;
    category: string;
    supplier: string;
    amountCents: number;
    dueDate: string;
    paid?: { method: PayMethod };
  }) => send<Expense>('POST', '/finance/expenses', data),
  payExpense: (id: string, method: PayMethod) =>
    send<Expense>('POST', `/finance/expenses/${id}/pay`, { method }),
  deleteExpense: (id: string) => send<void>('DELETE', `/finance/expenses/${id}`),
  summary: (month: string) => request<FinanceSummary>(`/finance/summary?month=${month}`),
  pixSettings: () => request<PixSettings>('/finance/pix'),
  savePix: (data: { accessToken?: string; depositCents?: number }) =>
    send<PixSettings>('PUT', '/finance/pix', data),
  removePix: () => send<PixSettings>('DELETE', '/finance/pix'),

  // estoque
  suppliers: () => request<Supplier[]>('/suppliers'),
  createSupplier: (data: Partial<Supplier> & { name: string }) =>
    send<Supplier>('POST', '/suppliers', data),
  updateSupplier: (id: string, data: Partial<Supplier>) =>
    send<Supplier>('PATCH', `/suppliers/${id}`, data),
  stock: () => request<StockItem[]>('/stock'),
  createItem: (data: Record<string, unknown>) => send<StockItem>('POST', '/stock/items', data),
  updateItem: (id: string, data: Record<string, unknown>) =>
    send<StockItem>('PATCH', `/stock/items/${id}`, data),
  itemMoves: (id: string) =>
    request<{ lots: StockLot[]; moves: StockMove[] }>(`/stock/items/${id}/moves`),
  stockOut: (
    id: string,
    data: { kind: 'loss' | 'expired' | 'manual'; qty: number; reason: string },
  ) => send<void>('POST', `/stock/items/${id}/out`, data),
  stockCount: (id: string, counted: number) =>
    send<{ difference: number }>('POST', `/stock/items/${id}/count`, { counted }),
  stockPurchase: (data: Record<string, unknown>) =>
    send<{
      id: string;
      totalCents: number;
      priceAlerts: Array<{ name: string; fromCents: number; toCents: number }>;
    }>('POST', '/stock/purchases', data),
  shopping: () => request<ShoppingGroup[]>('/stock/shopping'),
  orders: () =>
    request<
      Array<{
        id: string;
        supplierId: string | null;
        items: Array<{ itemId: string; purchaseQty: number }>;
        createdAt: string;
      }>
    >('/stock/orders'),
  createOrder: (supplierId: string | null, items: Array<{ itemId: string; purchaseQty: number }>) =>
    send<{ id: string }>('POST', '/stock/orders', { supplierId, items }),
  cancelOrder: (id: string) => send<void>('DELETE', `/stock/orders/${id}`),
  stockCheck: (serviceId: string, startsAt: string) =>
    request<Array<{ itemId: string; name: string; unit: string; need: number; available: number }>>(
      `/stock/check?${qs({ serviceId, startsAt })}`,
    ),
  stockReport: (month: string) => request<StockReport>(`/stock/report?month=${month}`),
  serviceMaterials: (id: string) =>
    request<Array<{ itemId: string; qty: number; name: string; unit: string; costCents: number }>>(
      `/services/${id}/materials`,
    ),
  setServiceMaterials: (id: string, list: Array<{ itemId: string; qty: number }>) =>
    send<unknown>('PUT', `/services/${id}/materials`, list),
  appointmentMaterials: (id: string) =>
    request<AppointmentMaterial[]>(`/appointments/${id}/materials`),
  addAppointmentMaterial: (id: string, itemId: string, qty: number) =>
    send<AppointmentMaterial[]>('POST', `/appointments/${id}/materials`, { itemId, qty }),
  results: (month: string) => request<Results>(`/results?month=${month}`),

  // convênios
  insurers: () => request<Insurer[]>('/insurers'),
  createInsurer: (data: Partial<Insurer> & { name: string }) =>
    send<Insurer>('POST', '/insurers', data),
  updateInsurer: (id: string, data: Partial<Insurer>) =>
    send<Insurer>('PATCH', `/insurers/${id}`, data),
  setInsurerPrices: (id: string, prices: Insurer['prices']) =>
    send<void>('PUT', `/insurers/${id}/prices`, prices),
  setInsurerProfessionals: (id: string, ids: string[]) =>
    send<void>('PUT', `/insurers/${id}/professionals`, ids),
  patientInsurance: (id: string) => request<PatientInsurance>(`/patients/${id}/insurance`),
  setCard: (
    id: string,
    insurerId: string,
    data: { cardNumber: string; planName: string; validUntil: string | null },
  ) => send<PatientInsurance>('PUT', `/patients/${id}/insurance/${insurerId}`, data),
  removeCard: (id: string, insurerId: string) =>
    send<PatientInsurance>('DELETE', `/patients/${id}/insurance/${insurerId}`),
  addAuthorization: (id: string, data: Record<string, unknown>) =>
    send<PatientInsurance>('POST', `/patients/${id}/authorizations`, data),
  removeAuthorization: (id: string) => send<void>('DELETE', `/authorizations/${id}`),
  setAppointmentInsurance: (id: string, insurerId: string | null, authorizationId: string | null) =>
    send<{ warnings: string[]; appointment: Appointment }>('PUT', `/appointments/${id}/insurance`, {
      insurerId,
      authorizationId,
    }),
  billing: (competence: string) => request<Billing>(`/insurance/billing?competence=${competence}`),
  createBatch: (insurerId: string, competence: string) =>
    send<Batch>('POST', '/insurance/batches', { insurerId, competence }),
  batch: (id: string) => request<Batch>(`/insurance/batches/${id}`),
  tissUrl: (id: string) => `/api/insurance/batches/${id}/tiss`,
  sendBatch: (id: string) => send<Batch>('POST', `/insurance/batches/${id}/send`),
  receiveBatch: (
    id: string,
    items: Array<{ claimId: string; paidCents: number; glosaReason: string }>,
  ) => send<Batch>('POST', `/insurance/batches/${id}/receive`, { items }),
  rebill: (claimId: string) => send<Batch>('POST', `/insurance/claims/${claimId}/rebill`),
  insuranceReport: () =>
    request<
      Array<{
        insurerId: string;
        name: string;
        billedCents: number;
        paidCents: number;
        glosaCents: number;
        receivableCents: number;
      }>
    >('/insurance/report'),

  // nota fiscal
  fiscal: () => request<FiscalSettings>('/nfse/settings'),
  saveFiscal: (data: Record<string, unknown>) =>
    send<FiscalSettings>('PUT', '/nfse/settings', data),
  removeFiscal: () => send<FiscalSettings>('DELETE', '/nfse/settings'),
  invoices: (chargeIds: string[]) =>
    request<ServiceInvoice[]>(`/nfse${chargeIds.length ? `?charges=${chargeIds.join(',')}` : ''}`),
  emitInvoice: (chargeId: string) => send<ServiceInvoice>('POST', '/nfse', { chargeId }),
  refreshInvoice: (id: string) => send<ServiceInvoice>('POST', `/nfse/${id}/refresh`),
  cancelInvoice: (id: string, reason: string) =>
    send<ServiceInvoice>('POST', `/nfse/${id}/cancel`, { reason }),
  receipt: (chargeId: string) => request<Receipt>(`/finance/charges/${chargeId}/receipt`),

  // LGPD
  exportPatientUrl: (id: string) => `/api/patients/${id}/export`,
  erasePatient: (id: string) =>
    send<{ mode: 'deleted' | 'contact_erased'; cancelledAppointments?: number }>(
      'POST',
      `/patients/${id}/erase`,
    ),
  exportClinicUrl: () => '/api/clinic/export',

  // relacionamento
  relationship: () => request<RelationshipSettings>('/relationship/settings'),
  saveRelationship: (patch: Partial<RelationshipSettings>) =>
    send<RelationshipSettings>('PATCH', '/relationship/settings', patch),
  reviews: () => request<Review[]>('/relationship/reviews'),

  // documentos
  documents: (patientId: string) => request<ClinicalDocument[]>(`/patients/${patientId}/documents`),
  createDocument: (
    patientId: string,
    data: { kind: DocumentKind; content: Record<string, unknown>; professionalId?: string },
  ) => send<ClinicalDocument>('POST', `/patients/${patientId}/documents`, data),
  document: (id: string) => request<PrintableDocument>(`/documents/${id}`),

  // relatórios
  overview: (month: string) => request<Overview>(`/reports/overview?month=${month}`),
  payouts: (month: string) => request<Payout[]>(`/reports/payouts?month=${month}`),
  commissions: () => request<CommissionSetting[]>('/reports/commissions'),
  saveCommission: (
    professionalId: string,
    data: {
      commissionPct: number;
      rules: Array<{ serviceId: string; pct?: number | null; fixedCents?: number | null }>;
    },
  ) => send<{ ok: true }>('PUT', `/reports/commissions/${professionalId}`, data),

  // recepção
  queue: () =>
    request<{
      waiting: QueueItem[];
      inProgress: QueueItem[];
      late: QueueItem[];
      next: QueueItem[];
    }>('/reception/queue'),
  callPatient: (appointmentId: string, destination?: string) =>
    send<{ id: string; displayName: string; destination: string }>(
      'POST',
      `/reception/call/${appointmentId}`,
      destination ? { destination } : {},
    ),
  tvLink: () => send<{ token: string }>('POST', '/reception/tv-link'),

  // equipe
  team: () => request<{ you: string; members: TeamMember[]; invites: Invite[] }>('/team'),
  createInvite: (name: string, role: ClinicRole) =>
    send<Invite>('POST', '/team/invites', { name, role }),
  renewInvite: (id: string) => send<Invite>('POST', `/team/invites/${id}/renew`),
  revokeInvite: (id: string) => send<void>('DELETE', `/team/invites/${id}`),
  changeRole: (membershipId: string, role: ClinicRole) =>
    send<void>('PATCH', `/team/members/${membershipId}`, { role }),
  removeMember: (membershipId: string) => send<void>('DELETE', `/team/members/${membershipId}`),
};

/** Arquivo de uma foto clínica (só abre com login). */
export const photoUrl = (id: string) => `/api/photos/${id}/file`;

/** Endereço do site público (agendamento e link do paciente). */
export const siteBase = () =>
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_URL ??
  'http://localhost:3001';
export const siteUrl = (slug: string) => `${siteBase()}/c/${slug}`;
export const linkPaciente = (token: string) => `${siteBase()}/a/${token}`;
export const linkTv = (token: string) => `${siteBase()}/tv/${token}`;
export const linkOrcamento = (token: string) => `${siteBase()}/o/${token}`;
