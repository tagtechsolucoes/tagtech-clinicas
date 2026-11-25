import { randomBytes } from 'node:crypto';

export type PixStatus = 'pending' | 'approved' | 'cancelled' | 'expired';

export interface PixCharge {
  providerPaymentId: string;
  pixCode: string;
  qrBase64: string;
  expiresAt: Date;
}

export interface CreatePixInput {
  amountCents: number;
  description: string;
  /** Nosso id da cobrança, para conferir no aviso. */
  chargeId: string;
  /** Endereço que o provedor chama quando o pagamento muda. */
  notificationUrl: string | null;
  expiresAt: Date;
  /** Chave para o provedor não cobrar duas vezes se repetirmos a chamada. */
  idempotencyKey: string;
}

export interface PixProvider {
  readonly name: 'mercadopago' | 'fake';
  create(input: CreatePixInput): Promise<PixCharge>;
  /** Situação atual, sempre perguntada ao provedor: o aviso em si não é prova de pagamento. */
  status(providerPaymentId: string): Promise<{ status: PixStatus; amountCents: number | null }>;
}

export class PixProviderError extends Error {}

const MP = 'https://api.mercadopago.com';

/** Pix pelo Mercado Pago, com a credencial (access token) da própria clínica. */
export class MercadoPagoPix implements PixProvider {
  readonly name = 'mercadopago' as const;
  constructor(
    private readonly accessToken: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async create(input: CreatePixInput): Promise<PixCharge> {
    const res = await this.http(`${MP}/v1/payments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        'x-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        description: input.description,
        payment_method_id: 'pix',
        external_reference: input.chargeId,
        date_of_expiration: input.expiresAt.toISOString().replace('Z', '+00:00'),
        // O Mercado Pago exige um e-mail do pagador; o Pix não usa.
        payer: { email: `cobranca-${input.chargeId.slice(0, 8)}@tagtechsolucoes.com.br` },
        ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as MpPayment | null;
    const data = body?.point_of_interaction?.transaction_data;
    if (!res.ok || !body?.id || !data?.qr_code) {
      throw new PixProviderError(
        res.status === 401
          ? 'A credencial do Mercado Pago da clínica não vale mais'
          : `Mercado Pago recusou o Pix (${res.status})`,
      );
    }
    return {
      providerPaymentId: String(body.id),
      pixCode: data.qr_code,
      qrBase64: data.qr_code_base64 ?? '',
      expiresAt: body.date_of_expiration ? new Date(body.date_of_expiration) : input.expiresAt,
    };
  }

  async status(id: string) {
    const res = await this.http(`${MP}/v1/payments/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new PixProviderError(`Mercado Pago não respondeu (${res.status})`);
    const body = (await res.json()) as MpPayment;
    const map: Record<string, PixStatus> = {
      approved: 'approved',
      cancelled: 'cancelled',
      rejected: 'cancelled',
      refunded: 'cancelled',
      charged_back: 'cancelled',
    };
    return {
      status: map[body.status ?? ''] ?? 'pending',
      amountCents:
        typeof body.transaction_amount === 'number'
          ? Math.round(body.transaction_amount * 100)
          : null,
    };
  }
}

interface MpPayment {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  date_of_expiration?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
}

/**
 * Pix de mentira para desenvolvimento e testes. Nunca roda em produção: o pagamento só
 * é aprovado pelo endereço de teste, que também só existe fora de produção.
 */
export class FakePix implements PixProvider {
  readonly name = 'fake' as const;
  static readonly approved = new Set<string>();

  async create(input: CreatePixInput): Promise<PixCharge> {
    const id = `fake-${randomBytes(8).toString('hex')}`;
    return {
      providerPaymentId: id,
      pixCode: `00020126580014BR.GOV.BCB.PIX0136${id}5204000053039865406${(input.amountCents / 100).toFixed(2)}5802BR6304TEST`,
      qrBase64: '',
      expiresAt: input.expiresAt,
    };
  }

  async status(id: string) {
    return {
      status: FakePix.approved.has(id) ? ('approved' as const) : ('pending' as const),
      amountCents: null,
    };
  }
}

export const fakePixAllowed = () => process.env.NODE_ENV !== 'production';
