import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Espelho, em TypeScript, das tabelas criadas em migrations/*.sql.
// As migrações em SQL são a fonte da verdade (é nelas que ficam RLS, checks e funções).

export const memberRole = pgEnum('member_role', ['owner', 'manager', 'reception', 'professional']);

const RECORD_KINDS = [
  'geral',
  'odonto',
  'estetica',
  'fisio',
  'psico',
  'nutri',
  'medicina',
] as const; // igual a @tagtech/domain

const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------------------------------------------------------------- clínica

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  brandPrimary: text('brand_primary').notNull().default('#1d4e5f'),
  brandAccent: text('brand_accent').notNull().default('#e9a23b'),
  displayFont: text('display_font', { enum: ['grotesca', 'serifada', 'condensada'] })
    .notNull()
    .default('grotesca'),
  tagline: text('tagline').notNull().default(''),
  about: text('about').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  instagram: text('instagram').notNull().default(''),
  logoUrl: text('logo_url'),
  coverUrl: text('cover_url'),
  bookingEnabled: boolean('booking_enabled').notNull().default(true),
  bookingMinNoticeMinutes: integer('booking_min_notice_minutes').notNull().default(120),
  bookingHorizonDays: integer('booking_horizon_days').notNull().default(60),
  slotStepMinutes: integer('slot_step_minutes').notNull().default(15),
  createdAt: createdAt(),
});

export const units = pgTable('units', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/Recife'),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- equipe

export const memberships = pgTable('memberships', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  unitId: uuid('unit_id'),
  role: memberRole('role').notNull(),
  createdAt: createdAt(),
});

export const invites = pgTable('invites', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  unitId: uuid('unit_id'),
  role: memberRole('role').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  acceptedBy: uuid('accepted_by'),
  revokedAt: ts('revoked_at'),
});

export const auditEvents = pgTable('audit_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  unitId: uuid('unit_id'),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- agenda

export const professionals = pgTable('professionals', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  membershipId: uuid('membership_id'),
  name: text('name').notNull(),
  specialty: text('specialty').notNull().default(''),
  council: text('council').notNull().default(''),
  bio: text('bio').notNull().default(''),
  photoUrl: text('photo_url'),
  color: text('color').notNull().default('#3b82a0'),
  onlineBooking: boolean('online_booking').notNull().default(true),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  recordKind: text('record_kind', { enum: RECORD_KINDS }).notNull().default('geral'),
  createdAt: createdAt(),
});

export const rooms = pgTable('rooms', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const services = pgTable('services', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default(''),
  durationMinutes: integer('duration_minutes').notNull(),
  priceCents: integer('price_cents'),
  color: text('color').notNull().default('#3b82a0'),
  onlineBooking: boolean('online_booking').notNull().default(true),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});

export const serviceProfessionals = pgTable(
  'service_professionals',
  {
    tenantId: uuid('tenant_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    professionalId: uuid('professional_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.professionalId] })],
);

export const workingHours = pgTable('working_hours', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  professionalId: uuid('professional_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startMinute: smallint('start_minute').notNull(),
  endMinute: smallint('end_minute').notNull(),
});

export const timeOff = pgTable('time_off', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  professionalId: uuid('professional_id'),
  unitId: uuid('unit_id'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  reason: text('reason').notNull().default(''),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const patientSource = pgEnum('patient_source', ['staff', 'online', 'import']);

export const patients = pgTable('patients', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  birthDate: date('birth_date'),
  cpf: text('cpf'),
  allergies: text('allergies').notNull().default(''),
  medications: text('medications').notNull().default(''),
  notes: text('notes').notNull().default(''),
  source: patientSource('source').notNull().default('staff'),
  consentAt: ts('consent_at'),
  createdAt: createdAt(),
});

export const patientAccessLog = pgTable('patient_access_log', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action', { enum: ['view', 'create', 'update'] }).notNull(),
  createdAt: createdAt(),
});

export const appointmentStatus = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'done',
  'no_show',
  'cancelled',
]);
export const appointmentSource = pgEnum('appointment_source', ['staff', 'online']);

export const appointments = pgTable('appointments', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  professionalId: uuid('professional_id').notNull(),
  roomId: uuid('room_id'),
  serviceId: uuid('service_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: appointmentStatus('status').notNull().default('scheduled'),
  source: appointmentSource('source').notNull().default('staff'),
  priceCents: integer('price_cents'),
  notes: text('notes').notNull().default(''),
  cancelReason: text('cancel_reason'),
  manageTokenHash: text('manage_token_hash'),
  confirmedAt: ts('confirmed_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const appointmentEvents = pgTable('appointment_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  fromStatus: appointmentStatus('from_status'),
  toStatus: appointmentStatus('to_status').notNull(),
  fromStartsAt: ts('from_starts_at'),
  actorUserId: uuid('actor_user_id'),
  actorKind: text('actor_kind', { enum: ['staff', 'patient', 'system'] })
    .notNull()
    .default('staff'),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const waitlistStatus = pgEnum('waitlist_status', [
  'waiting',
  'offered',
  'booked',
  'cancelled',
]);

export const waitlist = pgTable('waitlist', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  professionalId: uuid('professional_id'),
  unitId: uuid('unit_id'),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  period: text('period', { enum: ['any', 'morning', 'afternoon', 'evening'] })
    .notNull()
    .default('any'),
  notes: text('notes').notNull().default(''),
  status: waitlistStatus('status').notNull().default('waiting'),
  bookedAppointmentId: uuid('booked_appointment_id'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- WhatsApp

export const clinicWhatsapp = pgTable('clinic_whatsapp', {
  tenantId: uuid('tenant_id').primaryKey(),
  phoneNumberId: text('phone_number_id').notNull(),
  accessToken: text('access_token').notNull(),
  templateName: text('template_name').notNull().default('consulta_aviso'),
  templateLang: text('template_lang').notNull().default('pt_BR'),
  displayPhone: text('display_phone').notNull().default(''),
  reminderHours: integer('reminder_hours').notNull().default(24),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const appointmentMessages = pgTable('appointment_messages', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  event: text('event', { enum: ['booked', 'reminder', 'rescheduled', 'cancelled'] }).notNull(),
  forStartsAt: ts('for_starts_at').notNull(),
  status: text('status', { enum: ['sending', 'sent', 'failed'] })
    .notNull()
    .default('sending'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- prontuário

export const clinicalNotes = pgTable('clinical_notes', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  appointmentId: uuid('appointment_id'),
  professionalId: uuid('professional_id'),
  kind: text('kind', { enum: RECORD_KINDS }).notNull(),
  data: jsonb('data').$type<Record<string, string | number>>().notNull().default({}),
  text: text('text').notNull().default(''),
  private: boolean('private').notNull().default(false),
  authorUserId: uuid('author_user_id'),
  lockedAt: ts('locked_at'),
  addendumOf: uuid('addendum_of'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const toothChart = pgTable(
  'tooth_chart',
  {
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tooth: smallint('tooth').notNull(),
    state: text('state', {
      enum: [
        'caries',
        'restored',
        'missing',
        'implant',
        'crown',
        'root_canal',
        'extraction',
        'prosthesis',
        'healthy',
      ],
    }).notNull(),
    note: text('note').notNull().default(''),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.tooth] })],
);

export const patientPhotos = pgTable('patient_photos', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  appointmentId: uuid('appointment_id'),
  file: text('file').notNull(),
  stage: text('stage', { enum: ['before', 'during', 'after'] }).notNull(),
  region: text('region').notNull().default(''),
  angle: text('angle').notNull().default(''),
  takenOn: date('taken_on').notNull().defaultNow(),
  note: text('note').notNull().default(''),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const imageConsents = pgTable('image_consents', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  scope: text('scope', { enum: ['site', 'social', 'both'] }).notNull(),
  termText: text('term_text').notNull(),
  signedOn: date('signed_on').notNull(),
  recordedBy: uuid('recorded_by'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const galleryItems = pgTable('gallery_items', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  beforePhoto: uuid('before_photo').notNull(),
  afterPhoto: uuid('after_photo').notNull(),
  beforeUrl: text('before_url').notNull(),
  afterUrl: text('after_url').notNull(),
  title: text('title').notNull(),
  serviceId: uuid('service_id'),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});
