import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { resolveWhatsAppHook, schema, withTenant } from '@tagtech/db';
import { canonicalPhone } from '@tagtech/domain';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { parseInbound } from './inbound';
import { mesmoNumero, registrar, WhatsAppService } from './whatsapp.service';

const {
  appointments,
  clinicWhatsapp,
  patients,
  professionals,
  services,
  waConversations,
  waMessages,
} = schema;

const conversaView = (c: typeof waConversations.$inferSelect) => ({
  id: c.id,
  phone: c.phone,
  name: c.name,
  lastMessageAt: c.lastMessageAt.toISOString(),
  lastPreview: c.lastPreview,
  lastDirection: c.lastDirection,
  unread: c.unread,
});

/**
 * Central de conversas: o que os pacientes mandam para o número da clínica (conectado por
 * QR code) chega aqui, e a recepção responde pelo painel.
 */
@Injectable()
export class ConversationsService {
  private readonly log = new Logger('Conversas');

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {}

  async list(ctx: TenantContext, busca: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const q = busca.trim();
      const digitos = q.replace(/\D/g, '');
      const filtro = q
        ? or(
            ilike(waConversations.name, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
            ...(digitos.length >= 3 ? [sql`${waConversations.phone} like ${`%${digitos}%`}`] : []),
          )
        : undefined;
      const cfg = await this.whatsapp.loadCfg(tx);
      const rows = await tx
        .select()
        .from(waConversations)
        .where(filtro)
        .orderBy(desc(waConversations.lastMessageAt))
        .limit(100);
      return {
        // Só o QR code recebe e responde; pela Meta a clínica só manda as automáticas.
        canReply: cfg?.provider === 'evolution' && cfg.connection === 'open',
        connection: cfg?.provider === 'evolution' ? cfg.connection : null,
        provider: cfg?.provider ?? null,
        conversations: rows.map(conversaView),
      };
    });
  }

  async unread(ctx: TenantContext) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(waConversations)
        .where(gt(waConversations.unread, 0));
      return { conversations: r?.n ?? 0 };
    });
  }

  /** Mensagens (as 200 mais recentes), o paciente desse número e as próximas consultas. */
  async thread(ctx: TenantContext, id: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [c] = await tx.select().from(waConversations).where(eq(waConversations.id, id));
      if (!c) throw new NotFoundException('Conversa não encontrada');
      const msgs = await tx
        .select()
        .from(waMessages)
        .where(eq(waMessages.conversationId, id))
        .orderBy(desc(waMessages.createdAt))
        .limit(200);
      const achados = await tx
        .select({ id: patients.id, name: patients.name, phone: patients.phone })
        .from(patients)
        .where(and(mesmoNumero(patients.phone, c.phone), isNull(patients.contactErasedAt)))
        .limit(5);
      // Número de uma pessoa só: liga a conversa ao paciente. Vários (família): mostra todos.
      const proximas = achados.length
        ? await tx
            .select({
              id: appointments.id,
              patientId: appointments.patientId,
              startsAt: appointments.startsAt,
              status: appointments.status,
              service: services.name,
              professional: professionals.name,
            })
            .from(appointments)
            .innerJoin(services, eq(services.id, appointments.serviceId))
            .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
            .where(
              and(
                inArray(
                  appointments.patientId,
                  achados.map((p) => p.id),
                ),
                gte(appointments.startsAt, sql`now() - interval '2 hours'`),
                inArray(appointments.status, ['scheduled', 'confirmed', 'arrived']),
              ),
            )
            .orderBy(asc(appointments.startsAt))
            .limit(3)
        : [];
      return {
        conversation: conversaView(c),
        messages: msgs.reverse().map((m) => ({
          id: m.id,
          direction: m.direction,
          kind: m.kind,
          body: m.body,
          status: m.status,
          error: m.error,
          createdAt: m.createdAt.toISOString(),
        })),
        patients: achados,
        appointments: proximas.map((a) => ({ ...a, startsAt: a.startsAt.toISOString() })),
      };
    });
  }

  async markRead(ctx: TenantContext, id: string) {
    await inClinic(this.dbService.db, ctx, (tx) =>
      tx.update(waConversations).set({ unread: 0 }).where(eq(waConversations.id, id)),
    );
    return { ok: true };
  }

  /** Começa uma conversa com um número (ou devolve a que já existe). */
  async start(ctx: TenantContext, phoneInput: string, name: string) {
    const phone = canonicalPhone(phoneInput);
    if (!phone) throw new UnprocessableEntityException('WhatsApp inválido. Use DDD e número.');
    const nome = name.trim().slice(0, 120);
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [c] = await tx
        .insert(waConversations)
        .values({ tenantId: ctx.tenantId, phone, name: nome })
        .onConflictDoUpdate({
          target: [waConversations.tenantId, waConversations.phone],
          set: nome ? { name: nome } : { phone },
        })
        .returning();
      return conversaView(c!);
    });
  }

  /** Responde ao paciente. Grava antes de mandar, para a mensagem aparecer na hora. */
  async send(ctx: TenantContext, id: string, text: string) {
    const body = text.trim();
    if (!body) throw new UnprocessableEntityException('Escreva a mensagem');
    const prep = await inClinic(this.dbService.db, ctx, async (tx) => {
      const cfg = await this.whatsapp.loadCfg(tx);
      if (cfg?.provider !== 'evolution' || !cfg.instance) {
        throw new ConflictException(
          'Conecte o WhatsApp da clínica por QR code para responder daqui.',
        );
      }
      if (cfg.connection !== 'open') {
        throw new ConflictException(
          'O WhatsApp da clínica está desconectado. Leia o QR code de novo.',
        );
      }
      const [c] = await tx.select().from(waConversations).where(eq(waConversations.id, id));
      if (!c) throw new NotFoundException('Conversa não encontrada');
      const { message } = await registrar(tx, {
        tenantId: ctx.tenantId,
        phone: c.phone,
        direction: 'out',
        kind: 'text',
        body,
        status: 'sending',
        sentBy: ctx.user.userId,
      });
      return { cfg, conversation: c, message: message! };
    });

    const r = await this.whatsapp.sendText(prep.cfg, prep.conversation.phone, body);
    const [msg] = await withTenant(this.dbService.db, ctx.tenantId, (tx) =>
      tx
        .update(waMessages)
        .set(
          r.ok
            ? { status: 'sent', externalId: r.id || null }
            : { status: 'failed', error: r.error.slice(0, 500) },
        )
        .where(eq(waMessages.id, prep.message.id))
        .returning(),
    );
    if (!r.ok) throw new UnprocessableEntityException(`Não foi enviada: ${r.error}`);
    return { id: msg!.id, status: msg!.status };
  }

  /**
   * A Evolution chama aqui a cada mensagem e mudança de conexão. Endereço secreto por
   * clínica; qualquer coisa estranha é ignorada em silêncio (erro só a faria repetir).
   */
  async hook(secret: string, payload: unknown): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return;
    const found = await resolveWhatsAppHook(this.dbService.db, secret);
    if (!found) return;
    const instancia = (payload as { instance?: unknown } | null)?.instance;
    if (typeof instancia === 'string' && instancia !== found.instance) return;
    const ev = parseInbound(payload);
    if (!ev) return;
    const { tenantId } = found;

    if (ev.type === 'connection') {
      await withTenant(this.dbService.db, tenantId, (tx) =>
        tx.update(clinicWhatsapp).set({
          connection: ev.state,
          ...(ev.phone && ev.state === 'open' ? { displayPhone: ev.phone } : {}),
        }),
      );
      return;
    }

    const phone = canonicalPhone(ev.phone);
    if (!phone) return;
    const nova = await withTenant(this.dbService.db, tenantId, async (tx) => {
      const [repetida] = await tx
        .select({ id: waMessages.id })
        .from(waMessages)
        .where(eq(waMessages.externalId, ev.externalId));
      if (repetida) return false;
      if (ev.fromMe) {
        // Nossa própria resposta voltando antes de gravarmos o id: só liga as duas.
        const [nossa] = await tx
          .select({ id: waMessages.id })
          .from(waMessages)
          .innerJoin(waConversations, eq(waConversations.id, waMessages.conversationId))
          .where(
            and(
              eq(waConversations.phone, phone),
              eq(waMessages.direction, 'out'),
              eq(waMessages.body, ev.body),
              isNull(waMessages.externalId),
              sql`${waMessages.createdAt} > now() - interval '2 minutes'`,
            ),
          )
          .limit(1);
        if (nossa) {
          await tx
            .update(waMessages)
            .set({ externalId: ev.externalId })
            .where(eq(waMessages.id, nossa.id));
          return false;
        }
      }
      // Nome do paciente cadastrado, quando houver; senão, o nome do WhatsApp.
      const [paciente] = ev.fromMe
        ? []
        : await tx
            .select({ name: patients.name })
            .from(patients)
            .where(and(mesmoNumero(patients.phone, phone), isNull(patients.contactErasedAt)))
            .limit(2);
      await registrar(tx, {
        tenantId,
        phone,
        ...(ev.fromMe ? {} : { name: paciente?.name ?? ev.name }),
        direction: ev.fromMe ? 'out' : 'in',
        kind: ev.media ? 'media' : 'text',
        body: ev.body,
        status: ev.fromMe ? 'sent' : 'received',
        externalId: ev.externalId,
        // Hora em que chegou aqui: o relógio do celular do paciente pode estar errado.
        at: new Date(),
      });
      return !ev.fromMe && !ev.media;
    }).catch((e: unknown) => {
      this.log.warn(`Mensagem recebida não gravada: ${String(e)}`);
      return false;
    });
    // Respondeu 1 ou 2 ao lembrete: confirma ou pede para remarcar.
    if (nova) await this.whatsapp.patientReply(tenantId, phone, ev.body);
  }
}
