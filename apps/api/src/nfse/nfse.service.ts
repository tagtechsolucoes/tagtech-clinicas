import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { pgError, schema, withTenant, type TenantTx } from '@tagtech/db';
import { localClock } from '@tagtech/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';

const { charges, clinicFiscal, patients, serviceInvoices, units } = schema;
type Fiscal = typeof clinicFiscal.$inferSelect;
type Invoice = typeof serviceInvoices.$inferSelect;

/** fetch usado para falar com a Focus NFe. Os testes trocam por um falso. */
export const FOCUS_HTTP = Symbol('FOCUS_HTTP');

const BASE = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
} as const;
const PATH = { nacional: '/v2/nfsen', municipal: '/v2/nfse' } as const;

export interface FiscalInput {
  environment: 'homologacao' | 'producao';
  token?: string | undefined;
  standard: 'nacional' | 'municipal';
  cnpj: string;
  municipalRegistration: string;
  cityCode: string;
  serviceCode: string;
  municipalServiceCode: string;
  issRate: number;
  simplesOption: number;
  description: string;
  autoEmit: boolean;
}

interface FocusReply {
  status?: string;
  numero?: string;
  numero_nfse?: string;
  codigo_verificacao?: string;
  url?: string;
  url_danfse?: string;
  mensagem?: string;
  erros?: Array<{ codigo?: string; mensagem?: string; correcao?: string }>;
}

const reais = (c: number) => Math.round(c) / 100;
const auth = (token: string) => `Basic ${Buffer.from(`${token}:`).toString('base64')}`;

/**
 * NFS-e (nota de serviço) pela Focus NFe, com a conta da clínica. Uma nota por recebimento.
 * A nota é gravada antes de ir para a Focus, com referência única; sem resposta, fica
 * "emitindo" e o botão Atualizar consulta pela mesma referência.
 */
@Injectable()
export class NfseService {
  private readonly log = new Logger('NFS-e');
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(FOCUS_HTTP) private readonly http: typeof fetch,
  ) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ ajustes

  private view(f: Fiscal | undefined) {
    if (!f) return { configured: false as const };
    const { token: _t, tenantId: _x, updatedAt: _u, ...rest } = f;
    return { configured: true as const, ...rest };
  }

  settings(ctx: TenantContext) {
    return this.run(ctx, async (tx) => this.view((await tx.select().from(clinicFiscal))[0]));
  }

  save(ctx: TenantContext, input: FiscalInput) {
    return this.run(ctx, async (tx) => {
      const [atual] = await tx.select().from(clinicFiscal);
      const token = input.token ?? atual?.token;
      if (!token) throw new UnprocessableEntityException('Cole o token da Focus NFe');
      const { token: _t, ...rest } = input;
      const values = { ...rest, token, updatedAt: new Date() };
      const [f] = await tx
        .insert(clinicFiscal)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: clinicFiscal.tenantId, set: values })
        .returning();
      return this.view(f);
    });
  }

  remove(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      await tx.delete(clinicFiscal);
      return this.view(undefined);
    });
  }

  // ------------------------------------------------------------ notas

  toView(i: Invoice) {
    return {
      id: i.id,
      chargeId: i.chargeId,
      environment: i.environment,
      status: i.status,
      amountCents: i.amountCents,
      number: i.number,
      verificationCode: i.verificationCode,
      url: i.url,
      message: i.message,
      createdAt: i.createdAt.toISOString(),
    };
  }

  list(ctx: TenantContext, chargeIds?: string[]) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(serviceInvoices)
        .where(chargeIds?.length ? inArray(serviceInvoices.chargeId, chargeIds) : undefined)
        .orderBy(desc(serviceInvoices.createdAt))
        .limit(200);
      return rows.map((r) => this.toView(r));
    });
  }

  emit(ctx: TenantContext, chargeId: string) {
    return this.emitFor(ctx.tenantId, chargeId);
  }

  private async emitFor(tenantId: string, chargeId: string) {
    const db = this.dbService.db;
    const prep = await withTenant(db, tenantId, async (tx) => {
      const [fiscal] = await tx.select().from(clinicFiscal);
      if (!fiscal) throw new ConflictException('Configure a nota fiscal antes de emitir');
      const [c] = await tx.select().from(charges).where(eq(charges.id, chargeId));
      if (!c) throw new NotFoundException('Recebimento não encontrado');
      if (c.status !== 'paid') throw new ConflictException('Emita a nota depois de receber');
      const [p] = c.patientId
        ? await tx.select().from(patients).where(eq(patients.id, c.patientId))
        : [undefined];
      const [u] = await tx.select({ tz: units.timezone }).from(units).limit(1);
      const body = this.payload(fiscal, c, p, u?.tz ?? 'America/Sao_Paulo');
      const ref = `tt${randomBytes(9).toString('hex')}`;
      try {
        const [inv] = await tx
          .insert(serviceInvoices)
          .values({
            tenantId,
            chargeId,
            ref,
            environment: fiscal.environment,
            amountCents: c.amountCents,
          })
          .returning();
        return { fiscal, body, inv: inv! };
      } catch (e) {
        if (pgError(e).code === '23505')
          throw new ConflictException('Este recebimento já tem nota');
        throw e;
      }
    });

    let patch: Partial<Invoice>;
    try {
      const res = await this.http(
        `${BASE[prep.fiscal.environment]}${PATH[prep.fiscal.standard]}?ref=${prep.inv.ref}`,
        {
          method: 'POST',
          headers: { authorization: auth(prep.fiscal.token), 'content-type': 'application/json' },
          body: JSON.stringify(prep.body),
          signal: AbortSignal.timeout(30_000),
        },
      );
      patch = this.parse((await res.json().catch(() => null)) as FocusReply | null, res.status);
    } catch (e) {
      this.log.warn(`Focus sem resposta para ${prep.inv.ref}: ${String(e)}`);
      patch = { message: 'A Focus não respondeu. Toque em Atualizar em alguns segundos.' };
    }
    return withTenant(db, tenantId, async (tx) => {
      const [u] = await tx
        .update(serviceInvoices)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(serviceInvoices.id, prep.inv.id))
        .returning();
      return this.toView(u!);
    });
  }

  private parse(r: FocusReply | null, http: number): Partial<Invoice> {
    if (!r) return { status: 'error', message: `Focus respondeu ${http} sem conteúdo` };
    if (r.status === 'autorizado') {
      return {
        status: 'authorized',
        number: r.numero ?? r.numero_nfse ?? null,
        verificationCode: r.codigo_verificacao ?? null,
        url: r.url_danfse ?? r.url ?? null,
        message: null,
      };
    }
    if (r.status === 'processando_autorizacao')
      return { message: 'Em processamento na prefeitura' };
    if (r.status === 'cancelado') return { status: 'cancelled' };
    const erro = r.erros
      ?.map((e) => e.mensagem)
      .filter(Boolean)
      .join('; ');
    return { status: 'error', message: erro || r.mensagem || `Focus recusou (${http})` };
  }

  private payload(
    f: Fiscal,
    c: typeof charges.$inferSelect,
    p: typeof patients.$inferSelect | undefined,
    tz: string,
  ) {
    const hoje = localClock(new Date(), tz).ymd;
    const descricao = `${f.description} - ${c.description}`.slice(0, 2000);
    if (f.standard === 'nacional') {
      return {
        data_emissao: new Date().toISOString(),
        data_competencia: hoje,
        codigo_municipio_emissora: f.cityCode,
        cnpj_prestador: f.cnpj,
        ...(f.municipalRegistration
          ? { inscricao_municipal_prestador: f.municipalRegistration }
          : {}),
        codigo_opcao_simples_nacional: f.simplesOption,
        regime_especial_tributacao: 0,
        ...(p?.cpf ? { cpf_tomador: p.cpf } : {}),
        ...(p ? { razao_social_tomador: p.name.slice(0, 150) } : {}),
        ...(p?.email ? { email_tomador: p.email } : {}),
        codigo_municipio_prestacao: f.cityCode,
        codigo_tributacao_nacional_iss: f.serviceCode,
        ...(f.municipalServiceCode
          ? { codigo_tributacao_municipal_iss: f.municipalServiceCode }
          : {}),
        descricao_servico: descricao,
        valor_servico: reais(c.amountCents),
        tributacao_iss: 1,
        tipo_retencao_iss: 1,
        ...(f.issRate > 0 ? { percentual_aliquota_iss: f.issRate } : {}),
      };
    }
    return {
      data_emissao: new Date().toISOString(),
      prestador: {
        cnpj: f.cnpj,
        inscricao_municipal: f.municipalRegistration,
        codigo_municipio: f.cityCode,
      },
      ...(p
        ? {
            tomador: {
              ...(p.cpf ? { cpf: p.cpf } : {}),
              razao_social: p.name.slice(0, 115),
              ...(p.email ? { email: p.email } : {}),
            },
          }
        : {}),
      servico: {
        aliquota: f.issRate,
        discriminacao: descricao,
        iss_retido: false,
        item_lista_servico: f.serviceCode,
        ...(f.municipalServiceCode ? { codigo_tributario_municipio: f.municipalServiceCode } : {}),
        valor_servicos: reais(c.amountCents),
      },
    };
  }

  /** Pergunta à Focus como está a nota (emitindo ou autorizada). */
  async refresh(ctx: TenantContext, id: string) {
    const { inv, fiscal } = await this.run(ctx, async (tx) => {
      const [i] = await tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, id));
      if (!i) throw new NotFoundException('Nota não encontrada');
      const [f] = await tx.select().from(clinicFiscal);
      if (!f) throw new ConflictException('Nota fiscal desligada');
      return { inv: i, fiscal: f };
    });
    const res = await this.http(
      `${BASE[inv.environment as Fiscal['environment']]}${PATH[fiscal.standard]}/${inv.ref}`,
      {
        headers: { authorization: auth(fiscal.token) },
        signal: AbortSignal.timeout(20_000),
      },
    ).catch(() => null);
    if (!res) throw new UnprocessableEntityException('A Focus não respondeu. Tente de novo.');
    const patch = this.parse((await res.json().catch(() => null)) as FocusReply | null, res.status);
    return this.run(ctx, async (tx) => {
      const [u] = await tx
        .update(serviceInvoices)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(serviceInvoices.id, id))
        .returning();
      return this.toView(u!);
    });
  }

  async cancel(ctx: TenantContext, id: string, reason: string) {
    const { inv, fiscal } = await this.run(ctx, async (tx) => {
      const [i] = await tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, id));
      if (!i) throw new NotFoundException('Nota não encontrada');
      if (i.status !== 'authorized')
        throw new ConflictException('Só nota autorizada pode ser cancelada');
      const [f] = await tx.select().from(clinicFiscal);
      if (!f) throw new ConflictException('Nota fiscal desligada');
      return { inv: i, fiscal: f };
    });
    const res = await this.http(
      `${BASE[inv.environment as Fiscal['environment']]}${PATH[fiscal.standard]}/${inv.ref}`,
      {
        method: 'DELETE',
        headers: { authorization: auth(fiscal.token), 'content-type': 'application/json' },
        body: JSON.stringify({ justificativa: reason }),
        signal: AbortSignal.timeout(30_000),
      },
    ).catch(() => null);
    if (!res) throw new UnprocessableEntityException('A Focus não respondeu. Tente de novo.');
    const r = (await res.json().catch(() => null)) as FocusReply | null;
    if (r?.status !== 'cancelado')
      throw new UnprocessableEntityException(
        r?.erros?.[0]?.mensagem ?? r?.mensagem ?? 'A prefeitura não aceitou o cancelamento',
      );
    return this.run(ctx, async (tx) => {
      const [u] = await tx
        .update(serviceInvoices)
        .set({ status: 'cancelled', message: `Cancelada: ${reason}`, updatedAt: new Date() })
        .where(eq(serviceInvoices.id, id))
        .returning();
      return this.toView(u!);
    });
  }

  // ------------------------------------------------------------ automático

  /** Depois de receber: emite sozinha se a clínica pediu. Não atrasa o recebimento. */
  autoEmit(tenantId: string, chargeId: string): void {
    const p = (async () => {
      const ligado = await withTenant(this.dbService.db, tenantId, async (tx) => {
        const [f] = await tx.select().from(clinicFiscal);
        const [c] = await tx
          .select()
          .from(charges)
          .where(and(eq(charges.id, chargeId), eq(charges.status, 'paid')));
        // Convênio paga por lote: a nota do lote é emitida à mão.
        return f?.autoEmit === true && !!c && c.patientId !== null;
      });
      if (ligado) await this.emitFor(tenantId, chargeId);
    })()
      .catch((e: unknown) =>
        this.log.warn(`Nota automática não saiu: ${String((e as Error).message ?? e)}`),
      )
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }
}
