import type { AppointmentStatus, BrandTheme } from '@tagtech/domain';

export interface PublicClinic {
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
  booking: { enabled: boolean; horizonDays: number; depositCents: number };
  insurers: Array<{ id: string; name: string }>;
  gallery: Array<{
    id: string;
    title: string;
    serviceId: string | null;
    beforeUrl: string;
    afterUrl: string;
  }>;
  units: Array<{ id: string; name: string; address: string; phone: string; timezone: string }>;
  professionals: Array<{
    id: string;
    name: string;
    specialty: string;
    council: string;
    color?: string;
    bio: string;
    photoUrl: string | null;
    serviceIds: string[];
  }>;
  services: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    durationMinutes: number;
    priceCents: number | null;
    telehealth?: boolean;
    professionalIds: string[];
  }>;
}

export interface ManageView {
  clinic: {
    name: string;
    slug: string;
    tagline: string;
    whatsapp: string;
    instagram: string;
    logoUrl: string | null;
    coverUrl: string | null;
    theme: BrandTheme;
  };
  unit: { name: string; address: string; phone: string; timezone: string };
  serviceName: string;
  professionalName: string;
  patientFirstName: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  canConfirm: boolean;
  canCancel: boolean;
  deposit: { amountCents: number; status: 'open' | 'paid' | 'cancelled' } | null;
  telehealth: { opensAt: string; url: string | null; configured: boolean } | null;
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

export interface PlanView {
  clinic: ManageView['clinic'];
  patientFirstName: string;
  title: string;
  professionalName: string | null;
  status: 'draft' | 'sent' | 'approved' | 'declined' | 'cancelled';
  discountCents: number;
  cashDiscountPct: number;
  maxInstallments: number;
  notes: string;
  validUntil: string | null;
  chosenInstallments: number | null;
  subtotal: number;
  total: number;
  cashTotal: number;
  items: Array<{
    description: string;
    tooth: number | null;
    quantity: number;
    unitPriceCents: number;
  }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Chamada à API pelo /api do próprio site (sem CORS). */
export async function chamar<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json' } : {},
    });
  } catch {
    throw new ApiError('Sem conexão. Confira a internet e tente de novo.', 0);
  }
  const body = (await r.json().catch(() => null)) as {
    message?: string;
    fields?: Array<{ message: string }>;
  } | null;
  if (!r.ok) {
    throw new ApiError(
      body?.fields?.[0]?.message ?? body?.message ?? 'Não foi possível concluir. Tente de novo.',
      r.status,
    );
  }
  return body as T;
}

export interface OfferView {
  clinic: ManageView['clinic'];
  patientFirstName: string;
  serviceName: string;
  professionalName: string;
  unit: { name: string; address: string; timezone: string };
  startsAt: string;
  expiresAt: string;
  status: 'offered' | 'accepted' | 'declined' | 'expired' | 'taken';
  manageToken?: string | null;
}

export interface ReviewView {
  clinic: ManageView['clinic'];
  patientFirstName: string;
  rating: number | null;
  googleUrl: string | null;
}
