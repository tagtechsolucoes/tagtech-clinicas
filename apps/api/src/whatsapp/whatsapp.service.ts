import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { dueReminders, generateToken, schema, withTenant, type TenantTx } from '@tagtech/db';
import { messageSentence, normalizePhoneBR, whenText, type MessageEvent } from '@tagtech/domain';
import { asc, eq } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { hashToken } from '../common/token';

const { appointmentMessages, appointments, clinicWhatsapp, patients, services, tenants, units } =
  schema;

/** fetch usado para falar com a Meta. Os testes trocam por um falso. */
export const WHATSAPP_HTTP = Symbol('WHATSAPP_HTTP');

const GRAPH = 'https://graph.facebook.com/v21.0';
const VARREDURA_MS = 60_000;

export interface WhatsAppSettingsInput {
  phoneNumberId: string;
  accessToken?: string | undefined;
  templateName: string;
  templateLang: string;
  reminderHours: number;
  enabled: boolean;
}

const siteBase = () => (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Mensagens automáticas ao paciente: aviso ao agendar, remarcar e cancelar, e o lembrete
 * antes da consulta com o link para confirmar ou desmarcar. Usa a API oficial da Meta com
 * o número da clínica. Nunca atrasa nem derruba a agenda: roda por fora, e falha só fica
 * registrada.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhatsApp');
  private readonly inflight = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WHATSAPP_HTTP) private readonly http: typeof fetch,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.track(this.sweepReminders(new Date())), VARREDURA_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.idle();
  }

  /** Roda por fora, sem derrubar quem chamou; `idle()` espera. */
  track(p: Promise<unknown>) {
    const q = p.catch((e: unknown) => this.log.error(e)).finally(() => this.inflight.delete(q));
    this.inflight.add(q);
  }

  /** Espera os envios em andamento (testes e desligamento). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  /**
   * Chamado depois que a agenda muda. Volta na hora; o envio corre por fora.
   * `token` é o link recém-criado na marcação; sem ele, gera um novo (o antigo deixa de valer).
   */
  appointmentEvent(
    tenantId: string,
    appointmentId: string,
    event: MessageEvent,
    token?: string,
  ): void {
    this.track(this.send(tenantId, appointmentId, event, token));
  }

  /** Manda os lembretes que já estão na hora, de todas as clínicas. */
  async sweepReminders(now: Date): Promise<number> {
    const due = await dueReminders(this.dbService.db, now);
    for (const d of due) await this.send(d.tenantId, d.appointmentId, 'reminder', undefined, now);
    return due.length;
  }

  private async send(
    tenantId: string,
    appointmentId: string,
    event: MessageEvent,
    token?: string,
    now = new Date(),
  ) {
    const db = this.dbService.db;
    const job = await withTenant(db, tenantId, async (tx) => {
      const [cfg] = await tx.select().from(clinicWhatsapp);
      if (!cfg?.enabled) return null;
      const [row] = await tx
        .select({
          a: appointments,
          patient: patients,
          serviceName: services.name,
          tz: units.timezone,
        })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(units, eq(units.id, appointments.unitId))
        .where(eq(appointments.id, appointmentId));
      if (!row || !row.patient.phone) return null;
      // Reserva a mensagem: se outro processo já pegou, não manda de novo.
      const [claim] = await tx
        .insert(appointmentMessages)
        .values({ tenantId, appointmentId, event, forStartsAt: row.a.startsAt })
        .onConflictDoNothing()
        .returning({ id: appointmentMessages.id });
      if (!claim) return null;
      const [tenant] = await tx.select().from(tenants);
      let link = `${siteBase()}/c/${tenant!.slug}`;
      if (event !== 'cancelled') {
        let t = token;
        if (!t) {
          t = generateToken();
          await tx
            .update(appointments)
            .set({ manageTokenHash: hashToken(t) })
            .where(eq(appointments.id, appointmentId));
        }
        link = `${siteBase()}/a/${t}`;
      }
      return {
        cfg,
        claimId: claim.id,
        to: row.patient.phone,
        params: [
          row.patient.name.split(' ')[0]!,
          row.serviceName,
          tenant!.name,
          messageSentence(event, whenText(row.a.startsAt, row.tz, now)),
          link,
        ],
      };
    });
    if (!job) return;
    const result = await this.sendTemplate(job.cfg, job.to, job.params);
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(appointmentMessages)
        .set(
          result.ok
            ? { status: 'sent', providerMessageId: result.id }
            : { status: 'failed', error: result.error.slice(0, 500) },
        )
        .where(eq(appointmentMessages.id, job.claimId)),
    );
    if (!result.ok)
      this.log.warn(`Mensagem ${event} da consulta ${appointmentId} falhou: ${result.error}`);
  }

  /** Envia um modelo aprovado na Meta. `name` padrão: o aviso de consulta da clínica. */
  async sendTemplate(
    cfg: typeof clinicWhatsapp.$inferSelect,
    to: string,
    params: string[],
    name: string = cfg.templateName,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    try {
      const res = await this.http(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name,
            language: { code: cfg.templateLang },
            components: [
              { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.messages?.[0])
        return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
      return { ok: true, id: body.messages[0].id };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ---------------------------------------------------------------- painel

  private view(cfg: typeof clinicWhatsapp.$inferSelect | undefined) {
    return {
      configured: Boolean(cfg),
      enabled: cfg?.enabled ?? false,
      phoneNumberId: cfg?.phoneNumberId ?? '',
      displayPhone: cfg?.displayPhone ?? '',
      templateName: cfg?.templateName ?? 'consulta_aviso',
      templateLang: cfg?.templateLang ?? 'pt_BR',
      reminderHours: cfg?.reminderHours ?? 24,
    };
  }

  private load(tx: TenantTx) {
    return tx
      .select()
      .from(clinicWhatsapp)
      .then((r) => r[0]);
  }

  settings(ctx: TenantContext) {
    return inClinic(this.dbService.db, ctx, async (tx) => this.view(await this.load(tx)));
  }

  /** Salva e confere com a Meta que o número e o token funcionam. */
  async save(ctx: TenantContext, input: WhatsAppSettingsInput) {
    const atual = await inClinic(this.dbService.db, ctx, (tx) => this.load(tx));
    const token = input.accessToken ?? atual?.accessToken;
    if (!token) throw new UnprocessableEntityException('Cole o token de acesso da Meta');
    const res = await this.http(
      `${GRAPH}/${input.phoneNumberId}?fields=display_phone_number,verified_name`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() => null);
    if (!res) throw new UnprocessableEntityException('A Meta não respondeu. Tente de novo.');
    const info = (await res.json().catch(() => null)) as {
      display_phone_number?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new UnprocessableEntityException(
        `A Meta não aceitou: ${info?.error?.message ?? 'confira o ID do número e o token'}`,
      );
    }
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const values = {
        phoneNumberId: input.phoneNumberId,
        accessToken: token,
        templateName: input.templateName,
        templateLang: input.templateLang,
        reminderHours: input.reminderHours,
        enabled: input.enabled,
        displayPhone: info?.display_phone_number ?? '',
        updatedAt: new Date(),
      };
      const [cfg] = await tx
        .insert(clinicWhatsapp)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: clinicWhatsapp.tenantId, set: values })
        .returning();
      return this.view(cfg);
    });
  }

  setEnabled(ctx: TenantContext, enabled: boolean) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [cfg] = await tx
        .update(clinicWhatsapp)
        .set({ enabled, updatedAt: new Date() })
        .returning();
      if (!cfg) throw new NotFoundException('Configure o WhatsApp primeiro');
      return this.view(cfg);
    });
  }

  remove(ctx: TenantContext) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      await tx.delete(clinicWhatsapp);
      return this.view(undefined);
    });
  }

  /** Manda uma mensagem de exemplo para o número informado, com o modelo configurado. */
  async test(ctx: TenantContext, phone: string) {
    const to = normalizePhoneBR(phone);
    if (!to) throw new UnprocessableEntityException('WhatsApp inválido. Use DDD e número.');
    const { cfg, tenant } = await inClinic(this.dbService.db, ctx, async (tx) => ({
      cfg: await this.load(tx),
      tenant: (await tx.select().from(tenants))[0]!,
    }));
    if (!cfg) throw new NotFoundException('Configure o WhatsApp primeiro');
    const amanha = new Date(Date.now() + 24 * 3600_000);
    const result = await this.sendTemplate(cfg, to, [
      'Teste',
      'Avaliação',
      tenant.name,
      messageSentence('reminder', whenText(amanha, 'America/Recife')),
      `${siteBase()}/c/${tenant.slug}`,
    ]);
    if (!result.ok)
      throw new UnprocessableEntityException(`A Meta recusou a mensagem: ${result.error}`);
    return { sent: true };
  }

  /** Mensagens de uma consulta, para o histórico no painel. */
  messages(ctx: TenantContext, appointmentId: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(appointmentMessages)
        .where(eq(appointmentMessages.appointmentId, appointmentId))
        .orderBy(asc(appointmentMessages.createdAt));
      return rows.map((m) => ({
        event: m.event,
        status: m.status,
        error: m.error,
        at: m.createdAt.toISOString(),
      }));
    });
  }
}
