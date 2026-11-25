import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
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
  bookingDepositCents: integer('booking_deposit_cents').notNull().default(0),
  legalName: text('legal_name').notNull().default(''),
  document: text('document').notNull().default(''),
  insuranceEnabled: boolean('insurance_enabled').notNull().default(false),
  waitlistAutoOffer: boolean('waitlist_auto_offer').notNull().default(true),
  reactivationDays: integer('reactivation_days').notNull().default(0),
  googleReviewUrl: text('google_review_url').notNull().default(''),
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
  returnDays: integer('return_days'),
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
  contactErasedAt: ts('contact_erased_at'),
  createdAt: createdAt(),
});

export const patientAccessLog = pgTable('patient_access_log', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action', { enum: ['view', 'create', 'update', 'export', 'erase'] }).notNull(),
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
  packageId: uuid('package_id'),
  seriesId: uuid('series_id'),
  notes: text('notes').notNull().default(''),
  cancelReason: text('cancel_reason'),
  manageTokenHash: text('manage_token_hash'),
  confirmedAt: ts('confirmed_at'),
  insurerId: uuid('insurer_id'),
  authorizationId: uuid('authorization_id'),
  copayCents: integer('copay_cents'),
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

// ---------------------------------------------------------------- orçamento e financeiro

export const planStatus = pgEnum('plan_status', [
  'draft',
  'sent',
  'approved',
  'declined',
  'cancelled',
]);
export const payMethod = pgEnum('pay_method', [
  'pix',
  'cash',
  'debit',
  'credit',
  'transfer',
  'other',
]);
export const chargeStatus = pgEnum('charge_status', ['open', 'paid', 'cancelled']);
export const pixStatus = pgEnum('pix_status', ['pending', 'approved', 'cancelled', 'expired']);

export const treatmentPlans = pgTable('treatment_plans', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  professionalId: uuid('professional_id'),
  title: text('title').notNull(),
  status: planStatus('status').notNull().default('draft'),
  discountCents: integer('discount_cents').notNull().default(0),
  cashDiscountPct: smallint('cash_discount_pct').notNull().default(0),
  maxInstallments: smallint('max_installments').notNull().default(1),
  notes: text('notes').notNull().default(''),
  validUntil: date('valid_until'),
  approveTokenHash: text('approve_token_hash'),
  chosenInstallments: smallint('chosen_installments'),
  sentAt: ts('sent_at'),
  decidedAt: ts('decided_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const treatmentPlanItems = pgTable('treatment_plan_items', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  planId: uuid('plan_id').notNull(),
  serviceId: uuid('service_id'),
  description: text('description').notNull(),
  tooth: smallint('tooth'),
  quantity: smallint('quantity').notNull().default(1),
  unitPriceCents: integer('unit_price_cents').notNull(),
  position: integer('position').notNull().default(0),
  appointmentId: uuid('appointment_id'),
});

export const charges = pgTable('charges', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id'),
  planId: uuid('plan_id'),
  packageId: uuid('package_id'),
  appointmentId: uuid('appointment_id'),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  dueDate: date('due_date').notNull(),
  installment: smallint('installment').notNull().default(1),
  installments: smallint('installments').notNull().default(1),
  isDeposit: boolean('is_deposit').notNull().default(false),
  status: chargeStatus('status').notNull().default('open'),
  method: payMethod('method'),
  paidAt: ts('paid_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const expenses = pgTable('expenses', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default(''),
  supplier: text('supplier').notNull().default(''),
  amountCents: integer('amount_cents').notNull(),
  dueDate: date('due_date').notNull(),
  status: chargeStatus('status').notNull().default('open'),
  method: payMethod('method'),
  paidAt: ts('paid_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const clinicPaymentCredentials = pgTable('clinic_payment_credentials', {
  tenantId: uuid('tenant_id').primaryKey(),
  provider: text('provider', { enum: ['mercadopago'] })
    .notNull()
    .default('mercadopago'),
  accessToken: text('access_token').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const pixPayments = pgTable('pix_payments', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  chargeId: uuid('charge_id').notNull(),
  provider: text('provider', { enum: ['mercadopago', 'fake'] }).notNull(),
  providerPaymentId: text('provider_payment_id').notNull(),
  status: pixStatus('status').notNull().default('pending'),
  amountCents: integer('amount_cents').notNull(),
  pixCode: text('pix_code').notNull(),
  pixQrBase64: text('pix_qr_base64').notNull().default(''),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- estoque

const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' });

export const suppliers = pgTable('suppliers', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  contact: text('contact').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  email: text('email').notNull().default(''),
  leadTimeDays: smallint('lead_time_days').notNull().default(2),
  notes: text('notes').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const stockItems = pgTable('stock_items', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  unit: text('unit').notNull().default('unidade'),
  purchaseUnit: text('purchase_unit').notNull().default('unidade'),
  unitsPerPurchase: qty('units_per_purchase').notNull().default(1),
  costCents: integer('cost_cents').notNull().default(0),
  minQty: qty('min_qty').notNull().default(0),
  supplierId: uuid('supplier_id'),
  openValidityDays: smallint('open_validity_days'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const supplierPrices = pgTable(
  'supplier_prices',
  {
    tenantId: uuid('tenant_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    itemId: uuid('item_id').notNull(),
    lastPriceCents: integer('last_price_cents').notNull(),
    previousPriceCents: integer('previous_price_cents'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.itemId] })],
);

export const serviceMaterials = pgTable(
  'service_materials',
  {
    tenantId: uuid('tenant_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    itemId: uuid('item_id').notNull(),
    qty: qty('qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.itemId] })],
);

export const stockPurchases = pgTable('stock_purchases', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  supplierId: uuid('supplier_id'),
  invoice: text('invoice').notNull().default(''),
  totalCents: integer('total_cents').notNull(),
  receivedOn: date('received_on').notNull(),
  expenseId: uuid('expense_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const stockLots = pgTable('stock_lots', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  lot: text('lot').notNull().default(''),
  expiresOn: date('expires_on'),
  qty: qty('qty').notNull(),
  costCents: integer('cost_cents').notNull().default(0),
  openedAt: ts('opened_at'),
  purchaseId: uuid('purchase_id'),
  createdAt: createdAt(),
});

export const stockMoveKind = pgEnum('stock_move_kind', [
  'purchase',
  'consume',
  'return',
  'loss',
  'expired',
  'manual',
  'adjust',
]);

export const stockMoves = pgTable('stock_moves', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  lotId: uuid('lot_id'),
  kind: stockMoveKind('kind').notNull(),
  qty: qty('qty').notNull(),
  costCents: integer('cost_cents').notNull().default(0),
  reason: text('reason').notNull().default(''),
  appointmentId: uuid('appointment_id'),
  purchaseId: uuid('purchase_id'),
  userId: uuid('user_id'),
  createdAt: createdAt(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  supplierId: uuid('supplier_id'),
  status: text('status', { enum: ['open', 'received', 'cancelled'] })
    .notNull()
    .default('open'),
  items: jsonb('items')
    .$type<Array<{ itemId: string; purchaseQty: number }>>()
    .notNull()
    .default([]),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- convênios

export const insurers = pgTable('insurers', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  ansCode: text('ans_code').notNull().default(''),
  providerCode: text('provider_code').notNull().default(''),
  paymentDays: smallint('payment_days').notNull().default(30),
  showOnSite: boolean('show_on_site').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const insurerPrices = pgTable(
  'insurer_prices',
  {
    tenantId: uuid('tenant_id').notNull(),
    insurerId: uuid('insurer_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    priceCents: integer('price_cents').notNull(),
    copayCents: integer('copay_cents').notNull().default(0),
    tussCode: text('tuss_code').notNull().default(''),
    needsAuthorization: boolean('needs_authorization').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.insurerId, t.serviceId] })],
);

export const insurerProfessionals = pgTable(
  'insurer_professionals',
  {
    tenantId: uuid('tenant_id').notNull(),
    insurerId: uuid('insurer_id').notNull(),
    professionalId: uuid('professional_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.insurerId, t.professionalId] })],
);

export const patientInsurances = pgTable('patient_insurances', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  insurerId: uuid('insurer_id').notNull(),
  cardNumber: text('card_number').notNull(),
  planName: text('plan_name').notNull().default(''),
  validUntil: date('valid_until'),
  createdAt: createdAt(),
});

export const insuranceAuthorizations = pgTable('insurance_authorizations', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  insurerId: uuid('insurer_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  guideNumber: text('guide_number').notNull(),
  password: text('password').notNull().default(''),
  validUntil: date('valid_until'),
  sessions: smallint('sessions').notNull().default(1),
  createdAt: createdAt(),
});

export const insuranceBatches = pgTable('insurance_batches', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  insurerId: uuid('insurer_id').notNull(),
  number: integer('number').notNull(),
  competence: text('competence').notNull(),
  status: text('status', { enum: ['open', 'sent', 'paid'] })
    .notNull()
    .default('open'),
  sentAt: ts('sent_at'),
  paidAt: ts('paid_at'),
  chargeId: uuid('charge_id'),
  createdAt: createdAt(),
});

export const insuranceClaims = pgTable('insurance_claims', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  batchId: uuid('batch_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  billedCents: integer('billed_cents').notNull(),
  paidCents: integer('paid_cents'),
  glosaReason: text('glosa_reason').notNull().default(''),
  rebillOf: uuid('rebill_of'),
});

// ---------------------------------------------------------------- NFS-e

export const clinicFiscal = pgTable('clinic_fiscal', {
  tenantId: uuid('tenant_id').primaryKey(),
  environment: text('environment', { enum: ['homologacao', 'producao'] })
    .notNull()
    .default('homologacao'),
  token: text('token').notNull(),
  standard: text('standard', { enum: ['nacional', 'municipal'] })
    .notNull()
    .default('nacional'),
  cnpj: text('cnpj').notNull(),
  municipalRegistration: text('municipal_registration').notNull().default(''),
  cityCode: text('city_code').notNull(),
  serviceCode: text('service_code').notNull(),
  municipalServiceCode: text('municipal_service_code').notNull().default(''),
  issRate: numeric('iss_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  simplesOption: smallint('simples_option').notNull().default(3),
  description: text('description').notNull().default('Serviços de saúde'),
  autoEmit: boolean('auto_emit').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const nfseStatus = pgEnum('nfse_status', ['emitting', 'authorized', 'error', 'cancelled']);

export const serviceInvoices = pgTable('service_invoices', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  chargeId: uuid('charge_id').notNull(),
  ref: text('ref').notNull(),
  environment: text('environment', { enum: ['homologacao', 'producao'] }).notNull(),
  status: nfseStatus('status').notNull().default('emitting'),
  amountCents: integer('amount_cents').notNull(),
  number: text('number'),
  verificationCode: text('verification_code'),
  url: text('url'),
  message: text('message'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- relacionamento

export const patientMessages = pgTable('patient_messages', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  kind: text('kind', { enum: ['waitlist_offer', 'recall', 'reactivation', 'review'] }).notNull(),
  refId: uuid('ref_id').notNull(),
  serviceId: uuid('service_id'),
  status: text('status', { enum: ['sending', 'sent', 'failed'] })
    .notNull()
    .default('sending'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  createdAt: createdAt(),
});

export const waitlistOffers = pgTable('waitlist_offers', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  waitlistId: uuid('waitlist_id').notNull(),
  sourceAppointmentId: uuid('source_appointment_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  professionalId: uuid('professional_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  startsAt: ts('starts_at').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  status: text('status', { enum: ['offered', 'accepted', 'declined', 'expired', 'taken'] })
    .notNull()
    .default('offered'),
  bookedAppointmentId: uuid('booked_appointment_id'),
  decidedAt: ts('decided_at'),
  createdAt: createdAt(),
});

export const reviewRequests = pgTable('review_requests', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  rating: smallint('rating'),
  comment: text('comment').notNull().default(''),
  sentToGoogle: boolean('sent_to_google').notNull().default(false),
  answeredAt: ts('answered_at'),
  createdAt: createdAt(),
});

export const sessionPackages = pgTable('session_packages', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  title: text('title').notNull(),
  totalSessions: smallint('total_sessions').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  noShowCounts: boolean('no_show_counts').notNull().default(true),
  validUntil: date('valid_until'),
  status: text('status', { enum: ['active', 'finished', 'cancelled'] })
    .notNull()
    .default('active'),
  notes: text('notes').notNull().default(''),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});
