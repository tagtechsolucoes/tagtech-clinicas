import type {
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
  }) => send<Appointment>('POST', '/appointments', data),
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
