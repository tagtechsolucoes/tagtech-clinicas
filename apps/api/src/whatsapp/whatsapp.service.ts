import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  dueReminders,
  dueSoonReminders,
  generateToken,
  schema,
  withTenant,
  type TenantTx,
} from '@tagtech/db';
import {
  canonicalPhone,
  fillTemplate,
  messagePreview,
  messageSentence,
  normalizePhoneBR,
  parseReply,
  RELATIONSHIP_TEMPLATES,
  REPLY_HINT,
  whenText,
  WHATSAPP_TEMPLATE_BODY,
  type MessageEvent,
  type RelationshipTemplate,
} from '@tagtech/domain';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { hashToken } from '../common/token';
import { SubscriptionService } from '../subscription/subscription.service';
import { Evolution, EvolutionError, evolutionConfig, type QrCode } from './evolution';

const {
  appointmentEvents,
  appointmentMessages,
  appointments,
  clinicWhatsapp,
  patients,
  services,
  tenants,
  units,
  waConversations,
  waMessages,
} = schema;

type Cfg = typeof clinicWhatsapp.$inferSelect;
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

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

/** O que dá para mudar sem reconectar: liga/desliga e quando saem os lembretes. */
export interface WhatsAppPrefs {
  enabled?: boolean | undefined;
  reminderHours?: number | undefined;
  soonMinutes?: number | null | undefined;
}

/** O telefone pode estar gravado com ou sem 55 e nono dígito: compara os 8 últimos. */
export const mesmoNumero = (coluna: typeof patients.phone, phone: string) =>
  sql`right(regexp_replace(${coluna}, '\\D', '', 'g'), 8) = ${phone.slice(-8)}`;

/** Uma mensagem para gravar na conversa do paciente. */
export interface Registro {
  tenantId: string;
  phone: string;
  name?: string;
  direction: 'in' | 'out';
  kind: 'text' | 'auto' | 'media';
  body: string;
  status: 'sending' | 'sent' | 'failed' | 'received';
  externalId?: string | null;
  error?: string | null;
  sentBy?: string | null;
  at?: Date;
}

/** Grava a mensagem e atualiza a conversa (cria se for a primeira). */
export async function registrar(tx: TenantTx, r: Registro) {
  const at = r.at ?? new Date();
  const preview = messagePreview(r.body);
  const [conv] = await tx
    .insert(waConversations)
    .values({
      tenantId: r.tenantId,
      phone: r.phone,
      name: r.name ?? '',
      lastMessageAt: at,
      lastPreview: preview,
      lastDirection: r.direction,
      unread: r.direction === 'in' ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [waConversations.tenantId, waConversations.phone],
      set: {
        ...(r.name ? { name: r.name } : {}),
        lastMessageAt: sql`greatest(${waConversations.lastMessageAt}, ${at.toISOString()}::timestamptz)`,
        lastPreview: preview,
        lastDirection: r.direction,
        // Chegou: mais uma para ler. Respondeu à mão: a conversa foi vista.
        unread:
          r.direction === 'in'
            ? sql`${waConversations.unread} + 1`
            : r.kind === 'text'
              ? 0
              : sql`${waConversations.unread}`,
      },
    })
    .returning();
  const [msg] = await tx
    .insert(waMessages)
    .values({
      tenantId: r.tenantId,
      conversationId: conv!.id,
      direction: r.direction,
      kind: r.kind,
      body: r.body,
      status: r.status,
      externalId: r.externalId || null,
      error: r.error ? r.error.slice(0, 500) : null,
      sentBy: r.sentBy ?? null,
      createdAt: at,
    })
    // Id repetido do provedor: a mensagem já está gravada.
    .onConflictDoNothing({ target: [waMessages.tenantId, waMessages.externalId] })
    .returning();
  return { conversation: conv!, message: msg };
}

/** Texto de cada modelo, para mandar como mensagem comum pelo QR code. */
function corpoDoModelo(cfg: Cfg, name: string): string | null {
  if (name === cfg.templateName) return WHATSAPP_TEMPLATE_BODY;
  return RELATIONSHIP_TEMPLATES[name as RelationshipTemplate]?.body ?? null;
}

const siteBase = () => (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Mensagens automáticas ao paciente: aviso ao agendar, remarcar e cancelar, e o lembrete
 * antes da consulta com o link para confirmar ou desmarcar. Sai do número da clínica,
 * conectado por QR code (Evolution) ou pela API oficial da Meta. Nunca atrasa nem derruba a
 * agenda: roda por fora, e falha só fica registrada.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhatsApp');
  private readonly inflight = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WHATSAPP_HTTP) private readonly http: typeof fetch,
    @Inject(SubscriptionService) private readonly subs: SubscriptionService,
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

  /** Manda os lembretes que já estão na hora (véspera e do dia), de todas as clínicas. */
  async sweepReminders(now: Date): Promise<number> {
    const due = await dueReminders(this.dbService.db, now);
    for (const d of due) await this.send(d.tenantId, d.appointmentId, 'reminder', undefined, now);
    const soon = await dueSoonReminders(this.dbService.db, now);
    for (const d of soon) await this.send(d.tenantId, d.appointmentId, 'soon', undefined, now);
    return due.length + soon.length;
  }

  private async send(
    tenantId: string,
    appointmentId: string,
    event: MessageEvent,
    token?: string,
    now = new Date(),
  ) {
    if (!(await this.subs.active(tenantId))) return;
    const db = this.dbService.db;
    const job = await withTenant(db, tenantId, async (tx) => {
      const [cfg] = await tx.select().from(clinicWhatsapp);
      if (!cfg?.enabled) return null;
      const [row] = await tx
        .select({
          a: appointments,
          patient: patients,
          serviceName: services.name,
          telehealth: services.telehealth,
          tz: units.timezone,
          address: units.address,
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
      const onde = row.telehealth ? 'por vídeo' : row.address.trim().replace(/[.\s]+$/, '');
      // Pelo QR code, o paciente confirma respondendo 1 ali mesmo.
      const pedeResposta =
        event === 'reminder' || (event === 'soon' && row.a.status === 'scheduled');
      return {
        cfg,
        claimId: claim.id,
        nome: row.patient.name,
        to: row.patient.phone,
        rodape: pedeResposta ? REPLY_HINT : '',
        params: [
          row.patient.name.split(' ')[0]!,
          row.serviceName,
          tenant!.name,
          messageSentence(event, whenText(row.a.startsAt, row.tz, now), onde),
          link,
        ],
      };
    });
    if (!job) return;
    const result = await this.deliver(
      tenantId,
      job.cfg,
      job.to,
      job.params,
      undefined,
      job.nome,
      job.rodape,
    );
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

  /** Cliente da Evolution, ou null se o servidor não tem o serviço do QR code. */
  evolution(): Evolution | null {
    const cfg = evolutionConfig();
    return cfg ? new Evolution(this.http, cfg) : null;
  }

  private evolutionOrFail(): Evolution {
    const e = this.evolution();
    if (!e)
      throw new ServiceUnavailableException(
        'O WhatsApp por QR code não está ligado neste servidor.',
      );
    return e;
  }

  /**
   * Manda uma mensagem automática pelo provedor da clínica: o texto do modelo pelo QR code,
   * ou o modelo aprovado pela Meta. Com `tenantId`, a mensagem entra na conversa do paciente.
   * `name` padrão: o aviso de consulta da clínica. `rodape` só vai pelo QR code (o modelo da
   * Meta tem texto fixo).
   */
  async deliver(
    tenantId: string | null,
    cfg: Cfg,
    to: string,
    params: string[],
    name: string = cfg.templateName,
    contato = '',
    rodape = '',
  ): Promise<SendResult> {
    const corpo = corpoDoModelo(cfg, name);
    let texto = corpo ? fillTemplate(corpo, params) : params.join(' ');
    if (rodape && cfg.provider === 'evolution') texto += `\n\n${rodape}`;
    let r: SendResult;
    if (cfg.provider === 'evolution') {
      const evo = this.evolution();
      if (!evo || !cfg.instance) r = { ok: false, error: 'WhatsApp por QR code indisponível' };
      else {
        try {
          r = { ok: true, id: await evo.sendText(cfg.instance, to, texto) };
        } catch (e) {
          r = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
    } else {
      r = await this.sendTemplate(cfg, to, params, name);
    }
    const phone = canonicalPhone(to);
    if (tenantId && phone) {
      await withTenant(this.dbService.db, tenantId, (tx) =>
        registrar(tx, {
          tenantId,
          phone,
          name: contato,
          direction: 'out',
          kind: 'auto',
          body: texto,
          status: r.ok ? 'sent' : 'failed',
          externalId: r.ok ? r.id : null,
          error: r.ok ? null : r.error,
        }),
      ).catch((e: unknown) => this.log.warn(`Mensagem não entrou na conversa: ${String(e)}`));
    }
    return r;
  }

  /** Mensagem comum (resposta escrita no painel). Só pelo QR code. */
  async sendText(cfg: Cfg, to: string, texto: string): Promise<SendResult> {
    const evo = this.evolution();
    if (cfg.provider !== 'evolution' || !evo || !cfg.instance)
      return { ok: false, error: 'WhatsApp por QR code indisponível' };
    try {
      return { ok: true, id: await evo.sendText(cfg.instance, to, texto) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Envia um modelo aprovado na Meta. */
  private async sendTemplate(
    cfg: Cfg,
    to: string,
    params: string[],
    name: string,
  ): Promise<SendResult> {
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

  private view(cfg: Cfg | undefined) {
    return {
      configured: Boolean(cfg),
      provider: cfg?.provider ?? null,
      connection: !cfg
        ? ('close' as const)
        : cfg.provider === 'evolution'
          ? cfg.connection
          : ('open' as const),
      qrAvailable: evolutionConfig() !== null,
      enabled: cfg?.enabled ?? false,
      phoneNumberId: cfg?.phoneNumberId ?? '',
      displayPhone: cfg?.displayPhone ?? '',
      templateName: cfg?.templateName ?? 'consulta_aviso',
      templateLang: cfg?.templateLang ?? 'pt_BR',
      reminderHours: cfg?.reminderHours ?? 24,
      soonMinutes: cfg ? cfg.soonMinutes : 60,
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
    const token = input.accessToken ?? (atual?.provider === 'meta' ? atual.accessToken : null);
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
    // Trocando do QR code para a Meta: desliga o número da Evolution.
    if (atual?.provider === 'evolution' && atual.instance) {
      await this.evolution()?.remove(atual.instance);
    }
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const values = {
        provider: 'meta' as const,
        instance: null,
        hookSecret: null,
        connection: 'open' as const,
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

  setPrefs(ctx: TenantContext, prefs: WhatsAppPrefs) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [cfg] = await tx
        .update(clinicWhatsapp)
        .set({
          ...(prefs.enabled !== undefined ? { enabled: prefs.enabled } : {}),
          ...(prefs.reminderHours !== undefined ? { reminderHours: prefs.reminderHours } : {}),
          ...(prefs.soonMinutes !== undefined ? { soonMinutes: prefs.soonMinutes } : {}),
          updatedAt: new Date(),
        })
        .returning();
      if (!cfg) throw new NotFoundException('Configure o WhatsApp primeiro');
      return this.view(cfg);
    });
  }

  async remove(ctx: TenantContext) {
    const cfg = await inClinic(this.dbService.db, ctx, (tx) => this.load(tx));
    if (cfg?.provider === 'evolution' && cfg.instance) {
      await this.evolution()?.remove(cfg.instance);
    }
    return inClinic(this.dbService.db, ctx, async (tx) => {
      await tx.delete(clinicWhatsapp);
      return this.view(undefined);
    });
  }

  /**
   * Começa (ou retoma) a conexão por QR code: cria a instância da clínica na Evolution e
   * devolve o QR para ler no celular.
   */
  async startQr(ctx: TenantContext) {
    const evo = this.evolutionOrFail();
    const atual = await inClinic(this.dbService.db, ctx, (tx) => this.load(tx));
    let qr: QrCode;
    let instance: string;
    let hookSecret: string;
    try {
      if (atual?.provider === 'evolution' && atual.instance && atual.hookSecret) {
        instance = atual.instance;
        hookSecret = atual.hookSecret;
        await evo.setWebhook(instance, hookSecret).catch(() => undefined);
        qr = await evo.connect(instance);
      } else {
        // Nome único a cada conexão: uma instância velha esquecida não atrapalha.
        instance = `tc-${ctx.tenantId.slice(0, 8)}-${randomBytes(4).toString('hex')}`;
        hookSecret = randomBytes(32).toString('base64url');
        qr = await evo.create(instance, hookSecret);
        if (!qr.image && !qr.code) qr = await evo.connect(instance);
      }
    } catch (e) {
      throw new UnprocessableEntityException(
        e instanceof EvolutionError ? e.message : 'Não foi possível gerar o QR code.',
      );
    }
    const view = await inClinic(this.dbService.db, ctx, async (tx) => {
      const values = {
        provider: 'evolution' as const,
        instance,
        hookSecret,
        connection: 'connecting' as const,
        phoneNumberId: null,
        accessToken: null,
        displayPhone: atual?.provider === 'evolution' ? atual.displayPhone : '',
        enabled: atual?.enabled ?? true,
        updatedAt: new Date(),
      };
      const [cfg] = await tx
        .insert(clinicWhatsapp)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: clinicWhatsapp.tenantId, set: values })
        .returning();
      return this.view(cfg);
    });
    return { ...view, qr };
  }

  /** Situação da conexão por QR code. Conectou: guarda o número; senão, QR novo. */
  async qrStatus(ctx: TenantContext) {
    const evo = this.evolutionOrFail();
    const cfg = await inClinic(this.dbService.db, ctx, (tx) => this.load(tx));
    if (cfg?.provider !== 'evolution' || !cfg.instance) {
      throw new NotFoundException('Gere o QR code primeiro');
    }
    const state = await evo.state(cfg.instance).catch(() => 'close' as const);
    let qr: QrCode | null = null;
    let phone = cfg.displayPhone;
    if (state === 'open') phone = (await evo.ownerPhone(cfg.instance)) ?? phone;
    else qr = await evo.connect(cfg.instance).catch(() => null);
    const view = await inClinic(this.dbService.db, ctx, async (tx) => {
      const [c] = await tx
        .update(clinicWhatsapp)
        .set({ connection: state === 'open' ? 'open' : 'connecting', displayPhone: phone })
        .returning();
      return this.view(c);
    });
    return { ...view, qr };
  }

  /** Configuração da clínica para a central de conversas. */
  loadCfg(tx: TenantTx) {
    return this.load(tx);
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
    const result = await this.deliver(null, cfg, to, [
      'Teste',
      'Avaliação',
      tenant.name,
      messageSentence('reminder', whenText(amanha, 'America/Recife')),
      `${siteBase()}/c/${tenant.slug}`,
    ]);
    if (!result.ok)
      throw new UnprocessableEntityException(
        cfg.provider === 'evolution'
          ? `Não foi enviada: ${result.error}`
          : `A Meta recusou a mensagem: ${result.error}`,
      );
    return { sent: true };
  }

  /**
   * O paciente respondeu no WhatsApp (QR code). Se for 1 ou 2 logo depois de um lembrete,
   * confirma a consulta ou avisa que a recepção vai remarcar, e responde sozinho.
   * Devolve o que fez; qualquer outra mensagem fica só na conversa.
   */
  async patientReply(
    tenantId: string,
    phone: string,
    body: string,
    now = new Date(),
  ): Promise<'confirmed' | 'reschedule' | null> {
    const intent = parseReply(body);
    if (!intent) return null;
    const db = this.dbService.db;
    const job = await withTenant(db, tenantId, async (tx) => {
      const [cfg] = await tx.select().from(clinicWhatsapp);
      if (cfg?.provider !== 'evolution' || !cfg.enabled) return null;
      // A consulta do último lembrete que pediu resposta, ainda por vir.
      const [row] = await tx
        .select({
          a: appointments,
          patientName: patients.name,
          serviceName: services.name,
          tz: units.timezone,
        })
        .from(appointmentMessages)
        .innerJoin(appointments, eq(appointments.id, appointmentMessages.appointmentId))
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(units, eq(units.id, appointments.unitId))
        .where(
          and(
            inArray(appointmentMessages.event, ['reminder', 'soon']),
            eq(appointmentMessages.status, 'sent'),
            eq(appointmentMessages.forStartsAt, appointments.startsAt),
            gt(appointmentMessages.createdAt, new Date(now.getTime() - 4 * 86_400_000)),
            gt(appointments.startsAt, now),
            inArray(appointments.status, ['scheduled', 'confirmed']),
            mesmoNumero(patients.phone, phone),
          ),
        )
        .orderBy(desc(appointmentMessages.createdAt))
        .limit(1);
      if (!row) return null;
      const nome = row.patientName.split(' ')[0]!;
      const quando = whenText(row.a.startsAt, row.tz, now);
      if (intent === 'reschedule') {
        return {
          cfg,
          nome: row.patientName,
          texto: `Sem problema, ${nome}! A recepção vai falar com você aqui para combinar outro horário para ${row.serviceName}.`,
          result: 'reschedule' as const,
        };
      }
      if (row.a.status === 'scheduled') {
        await tx
          .update(appointments)
          .set({ status: 'confirmed', confirmedAt: now, updatedAt: now })
          .where(eq(appointments.id, row.a.id));
        await tx.insert(appointmentEvents).values({
          tenantId,
          appointmentId: row.a.id,
          fromStatus: 'scheduled',
          toStatus: 'confirmed',
          actorKind: 'patient',
          reason: 'Confirmou pelo WhatsApp',
        });
      }
      return {
        cfg,
        nome: row.patientName,
        texto: `Confirmado, ${nome}! Sua consulta de ${row.serviceName} é ${quando}. Até lá!`,
        result: 'confirmed' as const,
      };
    });
    if (!job) return null;
    const r = await this.sendText(job.cfg, phone, job.texto);
    await withTenant(db, tenantId, async (tx) => {
      const { conversation } = await registrar(tx, {
        tenantId,
        phone,
        name: job.nome,
        direction: 'out',
        kind: 'auto',
        body: job.texto,
        status: r.ok ? 'sent' : 'failed',
        externalId: r.ok ? r.id : null,
        error: r.ok ? null : r.error,
      });
      // Confirmou sozinho: a recepção não precisa ler o "1". Remarcar fica para ela ver.
      if (job.result === 'confirmed')
        await tx
          .update(waConversations)
          .set({ unread: sql`greatest(${waConversations.unread} - 1, 0)` })
          .where(eq(waConversations.id, conversation.id));
    }).catch((e: unknown) => this.log.warn(`Resposta automática não gravada: ${String(e)}`));
    return job.result;
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
