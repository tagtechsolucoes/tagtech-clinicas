import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  dueReactivations,
  dueRecalls,
  dueReviews,
  expiredOffers,
  generateToken,
  pgError,
  resolveOfferToken,
  resolveReviewToken,
  schema,
  withTenant,
  type TenantTx,
} from '@tagtech/db';
import { BLOCKING_STATUSES, localClock, whenText } from '@tagtech/domain';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { clinicView } from '../clinic/clinic.service';
import { inClinic } from '../common/clinic-scope';
import { hashToken } from '../common/token';
import { DbService } from '../db/db.module';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SubscriptionService } from '../subscription/subscription.service';

const {
  appointmentEvents,
  appointments,
  clinicWhatsapp,
  patientMessages,
  patients,
  professionals,
  reviewRequests,
  services,
  tenants,
  units,
  waitlist,
  waitlistOffers,
} = schema;

type Kind = 'waitlist_offer' | 'recall' | 'reactivation' | 'review';
const TEMPLATE: Record<Kind, string> = {
  waitlist_offer: 'vaga_oferta',
  recall: 'retorno_aviso',
  reactivation: 'reativacao',
  review: 'avaliacao_pedido',
};

/** Tempo que cada pessoa da fila tem para responder à vaga. */
const OFERTA_MS = 2 * 3600_000;
/** Vaga que começa em menos que isso não é oferecida (não dá tempo de vir). */
const ANTECEDENCIA_MS = 3 * 3600_000;
const siteBase = () => (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export interface RelationshipSettings {
  waitlistAutoOffer: boolean;
  reactivationDays: number;
  googleReviewUrl: string;
}

/**
 * Relacionamento com o paciente pelo WhatsApp, tudo automático:
 * - horário que vagou vai para a lista de espera, uma pessoa por vez;
 * - lembrete de retorno por serviço e mensagem para quem sumiu;
 * - pedido de avaliação depois da consulta; nota baixa fica com a clínica.
 */
@Injectable()
export class RelationshipService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Relacionamento');
  private timer: ReturnType<typeof setInterval> | null = null;
  private ciclo = 0;

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
    @Inject(SubscriptionService) private readonly subs: SubscriptionService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      const agora = new Date();
      this.whatsapp.track(this.sweepOffers(agora));
      // Retorno, reativação e avaliação: a cada 10 minutos basta.
      if (this.ciclo++ % 10 === 0) this.whatsapp.track(this.sweepMessages(agora));
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get db() {
    return this.dbService.db;
  }

  // ------------------------------------------------------------ configuração

  settings(ctx: TenantContext): Promise<RelationshipSettings> {
    return inClinic(this.db, ctx, async (tx) => {
      const [t] = await tx.select().from(tenants);
      return {
        waitlistAutoOffer: t!.waitlistAutoOffer,
        reactivationDays: t!.reactivationDays,
        googleReviewUrl: t!.googleReviewUrl,
      };
    });
  }

  async saveSettings(
    ctx: TenantContext,
    input: { [K in keyof RelationshipSettings]?: RelationshipSettings[K] | undefined },
  ) {
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length)
      await inClinic(this.db, ctx, (tx) =>
        tx.update(tenants).set(patch).where(eq(tenants.id, ctx.tenantId)),
      );
    return this.settings(ctx);
  }

  /** Avaliações respondidas (as baixas primeiro): a clínica lê e resolve. */
  reviews(ctx: TenantContext) {
    return inClinic(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ r: reviewRequests, name: patients.name, startsAt: appointments.startsAt })
        .from(reviewRequests)
        .innerJoin(patients, eq(patients.id, reviewRequests.patientId))
        .innerJoin(appointments, eq(appointments.id, reviewRequests.appointmentId))
        .where(gt(reviewRequests.rating, 0))
        .orderBy(asc(reviewRequests.rating), desc(reviewRequests.answeredAt))
        .limit(100);
      return rows.map(({ r, name, startsAt }) => ({
        id: r.id,
        patientId: r.patientId,
        patientName: name,
        appointmentStartsAt: startsAt.toISOString(),
        rating: r.rating!,
        comment: r.comment,
        sentToGoogle: r.sentToGoogle,
        answeredAt: r.answeredAt!.toISOString(),
      }));
    });
  }

  // ------------------------------------------------------------ envio

  /** Reserva a mensagem (uma por referência) e envia. Falha só fica registrada. */
  private async message(
    tenantId: string,
    kind: Kind,
    refId: string,
    patientId: string,
    serviceId: string | null,
    build: (tx: TenantTx) => Promise<string[] | null>,
  ) {
    const job = await withTenant(this.db, tenantId, async (tx) => {
      const [cfg] = await tx.select().from(clinicWhatsapp);
      if (!cfg?.enabled) return null;
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p?.phone || p.contactErasedAt) return null;
      const [claim] = await tx
        .insert(patientMessages)
        .values({ tenantId, patientId, kind, refId, serviceId })
        .onConflictDoNothing()
        .returning({ id: patientMessages.id });
      if (!claim) return null;
      const params = await build(tx);
      if (!params) return null;
      return { cfg, to: p.phone, params, claimId: claim.id };
    });
    if (!job) return false;
    const r = await this.whatsapp.sendTemplate(job.cfg, job.to, job.params, TEMPLATE[kind]);
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(patientMessages)
        .set(
          r.ok
            ? { status: 'sent', providerMessageId: r.id }
            : { status: 'failed', error: r.error.slice(0, 500) },
        )
        .where(eq(patientMessages.id, job.claimId)),
    );
    if (!r.ok) this.log.warn(`Mensagem ${kind} falhou: ${r.error}`);
    return r.ok;
  }

  // ------------------------------------------------------------ lista de espera

  /** Um horário vagou (consulta cancelada): oferece para o próximo da fila. Volta na hora. */
  slotFreed(tenantId: string, appointmentId: string): void {
    this.whatsapp.track(this.offerNext(tenantId, appointmentId, new Date()));
  }

  /** Oferece a vaga da consulta cancelada para a próxima pessoa da fila que ainda não recebeu. */
  async offerNext(tenantId: string, sourceId: string, now: Date): Promise<string | null> {
    if (!(await this.subs.has(tenantId, 'relationship'))) return null;
    const oferta = await withTenant(this.db, tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants);
      const [cfg] = await tx.select().from(clinicWhatsapp);
      if (!t!.waitlistAutoOffer || !cfg?.enabled) return null;
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, sourceId));
      if (!a || a.status !== 'cancelled') return null;
      if (a.startsAt.getTime() - now.getTime() < ANTECEDENCIA_MS) return null;
      // Alguém já está com a oferta desta vaga.
      const [aberta] = await tx
        .select({ id: waitlistOffers.id })
        .from(waitlistOffers)
        .where(
          and(
            eq(waitlistOffers.sourceAppointmentId, sourceId),
            eq(waitlistOffers.status, 'offered'),
          ),
        );
      if (aberta) return null;
      // O horário ainda está livre?
      const [ocupado] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.professionalId, a.professionalId),
            inArray(appointments.status, BLOCKING_STATUSES),
            lt(appointments.startsAt, a.endsAt),
            gt(appointments.endsAt, a.startsAt),
          ),
        );
      if (ocupado) return null;

      const [unit] = await tx.select().from(units).where(eq(units.id, a.unitId));
      const local = localClock(a.startsAt, unit!.timezone);
      const periodo =
        local.minute < 12 * 60 ? 'morning' : local.minute < 18 * 60 ? 'afternoon' : 'evening';
      const jaOfertados = (
        await tx
          .select({ w: waitlistOffers.waitlistId })
          .from(waitlistOffers)
          .where(eq(waitlistOffers.sourceAppointmentId, sourceId))
      ).map((r) => r.w);
      const [w] = await tx
        .select({ w: waitlist })
        .from(waitlist)
        .innerJoin(patients, eq(patients.id, waitlist.patientId))
        .where(
          and(
            eq(waitlist.status, 'waiting'),
            eq(waitlist.serviceId, a.serviceId),
            or(isNull(waitlist.professionalId), eq(waitlist.professionalId, a.professionalId)),
            or(isNull(waitlist.unitId), eq(waitlist.unitId, a.unitId)),
            lte(waitlist.fromDate, local.ymd),
            gte(waitlist.toDate, local.ymd),
            inArray(waitlist.period, ['any', periodo]),
            // Quem cancelou não recebe a própria vaga.
            notInArray(waitlist.patientId, [a.patientId]),
            jaOfertados.length ? notInArray(waitlist.id, jaOfertados) : undefined,
            isNull(patients.contactErasedAt),
          ),
        )
        .orderBy(asc(waitlist.createdAt))
        .limit(1);
      if (!w) return null;
      const token = generateToken();
      // Até 2 h para responder, e nunca mais tarde que 2 h antes da consulta.
      const expira = new Date(
        Math.min(now.getTime() + OFERTA_MS, a.startsAt.getTime() - OFERTA_MS),
      );
      const [o] = await tx
        .insert(waitlistOffers)
        .values({
          tenantId,
          waitlistId: w.w.id,
          sourceAppointmentId: sourceId,
          serviceId: a.serviceId,
          professionalId: a.professionalId,
          unitId: a.unitId,
          startsAt: a.startsAt,
          tokenHash: hashToken(token),
          expiresAt: expira,
        })
        .onConflictDoNothing()
        .returning();
      if (!o) return null;
      await tx.update(waitlist).set({ status: 'offered' }).where(eq(waitlist.id, w.w.id));
      const [s] = await tx.select().from(services).where(eq(services.id, a.serviceId));
      return {
        offer: o,
        patientId: w.w.patientId,
        params: (nome: string) => [
          nome,
          s!.name,
          t!.name,
          whenText(a.startsAt, unit!.timezone, now),
          whenText(expira, unit!.timezone, now),
          `${siteBase()}/v/${token}`,
        ],
      };
    });
    if (!oferta) return null;
    await this.message(
      tenantId,
      'waitlist_offer',
      oferta.offer.id,
      oferta.patientId,
      oferta.offer.serviceId,
      async (tx) => {
        const [p] = await tx.select().from(patients).where(eq(patients.id, oferta.patientId));
        return oferta.params(p!.name.split(' ')[0]!);
      },
    );
    return oferta.offer.id;
  }

  /** Ofertas vencidas passam a vez. */
  async sweepOffers(now: Date): Promise<number> {
    const vencidas = await expiredOffers(this.db, now);
    for (const v of vencidas) {
      const src = await withTenant(this.db, v.tenantId, async (tx) => {
        const [o] = await tx
          .update(waitlistOffers)
          .set({ status: 'expired', decidedAt: now })
          .where(and(eq(waitlistOffers.id, v.id), eq(waitlistOffers.status, 'offered')))
          .returning();
        if (!o) return null;
        await tx
          .update(waitlist)
          .set({ status: 'waiting' })
          .where(and(eq(waitlist.id, o.waitlistId), eq(waitlist.status, 'offered')));
        return o.sourceAppointmentId;
      });
      if (src) await this.offerNext(v.tenantId, src, now);
    }
    return vencidas.length;
  }

  private async byOffer<T>(
    token: string,
    fn: (tx: TenantTx, offerId: string, tenantId: string) => Promise<T>,
  ) {
    const found = await resolveOfferToken(this.db, hashToken(token));
    if (!found) throw new GoneException('Este link não vale mais.');
    return withTenant(this.db, found.tenantId, (tx) => fn(tx, found.id, found.tenantId));
  }

  private async offerView(tx: TenantTx, offerId: string) {
    const [row] = await tx
      .select({
        o: waitlistOffers,
        serviceName: services.name,
        professionalName: professionals.name,
        unit: units,
        tenant: tenants,
        patientName: patients.name,
      })
      .from(waitlistOffers)
      .innerJoin(services, eq(services.id, waitlistOffers.serviceId))
      .innerJoin(professionals, eq(professionals.id, waitlistOffers.professionalId))
      .innerJoin(units, eq(units.id, waitlistOffers.unitId))
      .innerJoin(tenants, eq(tenants.id, waitlistOffers.tenantId))
      .innerJoin(waitlist, eq(waitlist.id, waitlistOffers.waitlistId))
      .innerJoin(patients, eq(patients.id, waitlist.patientId))
      .where(eq(waitlistOffers.id, offerId));
    if (!row) throw new GoneException('Este link não vale mais.');
    const { booking: _b, about: _a, ...brand } = clinicView(row.tenant);
    const vencida = row.o.status === 'offered' && row.o.expiresAt.getTime() <= Date.now();
    return {
      clinic: brand,
      patientFirstName: row.patientName.split(' ')[0]!,
      serviceName: row.serviceName,
      professionalName: row.professionalName,
      unit: { name: row.unit.name, address: row.unit.address, timezone: row.unit.timezone },
      startsAt: row.o.startsAt.toISOString(),
      expiresAt: row.o.expiresAt.toISOString(),
      status: vencida ? ('expired' as const) : row.o.status,
    };
  }

  offer(token: string) {
    return this.byOffer(token, (tx, id) => this.offerView(tx, id));
  }

  /** O paciente quer o horário: marca na hora se ainda estiver livre. */
  async acceptOffer(token: string) {
    const r = await this.byOffer(token, async (tx, id, tenantId) => {
      const [o] = await tx
        .select()
        .from(waitlistOffers)
        .where(eq(waitlistOffers.id, id))
        .for('update');
      if (!o) throw new GoneException('Este link não vale mais.');
      if (o.status === 'accepted') return { view: await this.offerView(tx, id), booked: null };
      if (o.status !== 'offered')
        throw new ConflictException('Este horário não está mais disponível.');
      if (o.expiresAt.getTime() <= Date.now())
        throw new ConflictException('O prazo para ficar com este horário acabou.');
      const [w] = await tx.select().from(waitlist).where(eq(waitlist.id, o.waitlistId));
      if (!w) throw new GoneException('Este link não vale mais.');
      const [s] = await tx.select().from(services).where(eq(services.id, o.serviceId));
      const [src] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, o.sourceAppointmentId));
      const manage = generateToken();
      const valores = {
        tenantId,
        unitId: o.unitId,
        professionalId: o.professionalId,
        serviceId: o.serviceId,
        patientId: w!.patientId,
        startsAt: o.startsAt,
        endsAt: new Date(o.startsAt.getTime() + s!.durationMinutes * 60_000),
        priceCents: s!.priceCents,
        manageTokenHash: hashToken(manage),
        notes: 'Horário da lista de espera',
      };
      // Tenta com a mesma sala; se ela foi ocupada, sem sala. Profissional ocupado = perdeu a vaga.
      let nova: typeof appointments.$inferSelect | undefined;
      for (const roomId of [src?.roomId ?? null, null]) {
        try {
          nova = await tx.transaction(
            async (sp) =>
              (
                await sp
                  .insert(appointments)
                  .values({ ...valores, roomId })
                  .returning()
              )[0],
          );
          break;
        } catch (e) {
          const nome = pgError(e).constraint;
          if (nome === 'appointments_room_free' && roomId) continue;
          if (nome === 'appointments_professional_free') {
            await tx
              .update(waitlistOffers)
              .set({ status: 'taken', decidedAt: new Date() })
              .where(eq(waitlistOffers.id, id));
            await tx
              .update(waitlist)
              .set({ status: 'waiting' })
              .where(eq(waitlist.id, o.waitlistId));
            return { view: null, booked: null };
          }
          throw e;
        }
      }
      await tx.insert(appointmentEvents).values({
        tenantId,
        appointmentId: nova!.id,
        toStatus: 'scheduled',
        actorKind: 'patient',
        reason: 'Lista de espera',
      });
      await tx
        .update(waitlistOffers)
        .set({ status: 'accepted', decidedAt: new Date(), bookedAppointmentId: nova!.id })
        .where(eq(waitlistOffers.id, id));
      await tx
        .update(waitlist)
        .set({ status: 'booked', bookedAppointmentId: nova!.id })
        .where(eq(waitlist.id, o.waitlistId));
      return {
        view: await this.offerView(tx, id),
        booked: { tenantId, appointmentId: nova!.id, manage },
      };
    });
    if (!r.view)
      throw new ConflictException(
        'Alguém ficou com este horário um pouco antes. Você continua na lista de espera.',
      );
    if (r.booked)
      this.whatsapp.appointmentEvent(
        r.booked.tenantId,
        r.booked.appointmentId,
        'booked',
        r.booked.manage,
      );
    return { ...r.view, manageToken: r.booked?.manage ?? null };
  }

  /** Não pode: passa para o próximo e continua na fila para outras vagas. */
  async declineOffer(token: string) {
    const r = await this.byOffer(token, async (tx, id, tenantId) => {
      const [o] = await tx
        .update(waitlistOffers)
        .set({ status: 'declined', decidedAt: new Date() })
        .where(and(eq(waitlistOffers.id, id), eq(waitlistOffers.status, 'offered')))
        .returning();
      if (o)
        await tx
          .update(waitlist)
          .set({ status: 'waiting' })
          .where(and(eq(waitlist.id, o.waitlistId), eq(waitlist.status, 'offered')));
      return { view: await this.offerView(tx, id), tenantId, src: o?.sourceAppointmentId ?? null };
    });
    if (r.src) this.whatsapp.track(this.offerNext(r.tenantId, r.src, new Date()));
    return r.view;
  }

  // ------------------------------------------------------------ retorno, reativação, avaliação

  /** Só manda mensagem que não é de consulta entre 9h e 20h no fuso da clínica. */
  private async horaBoa(tx: TenantTx, now: Date) {
    const [u] = await tx
      .select({ tz: units.timezone })
      .from(units)
      .orderBy(asc(units.createdAt))
      .limit(1);
    const m = localClock(now, u?.tz ?? 'America/Recife').minute;
    return { ok: m >= 9 * 60 && m < 20 * 60, tz: u?.tz ?? 'America/Recife' };
  }

  async sweepMessages(now: Date) {
    let enviadas = 0;
    const pode = (t: string) => this.subs.has(t, 'relationship');
    for (const d of await dueRecalls(this.db, now))
      if ((await pode(d.tenantId)) && (await this.recall(d.tenantId, d.id, now))) enviadas++;
    for (const d of await dueReactivations(this.db, now))
      if ((await pode(d.tenantId)) && (await this.reactivate(d.tenantId, d.id, now))) enviadas++;
    for (const d of await dueReviews(this.db, now))
      if ((await pode(d.tenantId)) && (await this.askReview(d.tenantId, d.id, now))) enviadas++;
    return enviadas;
  }

  private async base(tx: TenantTx, appointmentId: string) {
    const [row] = await tx
      .select({ a: appointments, p: patients, s: services, t: tenants })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .where(eq(appointments.id, appointmentId));
    return row ?? null;
  }

  private async recall(tenantId: string, appointmentId: string, now: Date) {
    const info = await withTenant(this.db, tenantId, async (tx) => ({
      row: await this.base(tx, appointmentId),
      hora: await this.horaBoa(tx, now),
    }));
    if (!info.row || !info.hora.ok) return false;
    const { a, p, s, t } = info.row;
    return this.message(tenantId, 'recall', a.id, p.id, s.id, async () => [
      p.name.split(' ')[0]!,
      s.name,
      t.name,
      `${siteBase()}/c/${t.slug}?servico=${s.id}#agendar`,
    ]);
  }

  private async reactivate(tenantId: string, appointmentId: string, now: Date) {
    const info = await withTenant(this.db, tenantId, async (tx) => ({
      row: await this.base(tx, appointmentId),
      hora: await this.horaBoa(tx, now),
    }));
    if (!info.row || !info.hora.ok) return false;
    const { a, p, t } = info.row;
    return this.message(tenantId, 'reactivation', a.id, p.id, null, async () => [
      p.name.split(' ')[0]!,
      t.name,
      `${siteBase()}/c/${t.slug}#agendar`,
    ]);
  }

  private async askReview(tenantId: string, appointmentId: string, now: Date) {
    const token = generateToken();
    const ok = await withTenant(this.db, tenantId, async (tx) => {
      const row = await this.base(tx, appointmentId);
      const hora = await this.horaBoa(tx, now);
      if (!row || !hora.ok) return null;
      const [r] = await tx
        .insert(reviewRequests)
        .values({ tenantId, appointmentId, patientId: row.p.id, tokenHash: hashToken(token) })
        .onConflictDoNothing()
        .returning();
      return r ? row : null;
    });
    if (!ok) return false;
    return this.message(tenantId, 'review', appointmentId, ok.p.id, ok.s.id, async () => [
      ok.p.name.split(' ')[0]!,
      ok.t.name,
      `${siteBase()}/r/${token}`,
    ]);
  }

  // ------------------------------------------------------------ avaliação (link público)

  private async byReview<T>(token: string, fn: (tx: TenantTx, id: string) => Promise<T>) {
    const found = await resolveReviewToken(this.db, hashToken(token));
    if (!found) throw new GoneException('Este link não vale mais.');
    return withTenant(this.db, found.tenantId, (tx) => fn(tx, found.id));
  }

  private async reviewView(tx: TenantTx, id: string) {
    const [row] = await tx
      .select({ r: reviewRequests, name: patients.name, t: tenants })
      .from(reviewRequests)
      .innerJoin(patients, eq(patients.id, reviewRequests.patientId))
      .innerJoin(tenants, eq(tenants.id, reviewRequests.tenantId))
      .where(eq(reviewRequests.id, id));
    if (!row) throw new NotFoundException();
    const { booking: _b, about: _a, ...brand } = clinicView(row.t);
    return {
      clinic: brand,
      patientFirstName: row.name.split(' ')[0]!,
      rating: row.r.rating,
      // Só mostra o link do Google para quem deu nota alta.
      googleUrl: row.r.rating && row.r.rating >= 4 ? row.t.googleReviewUrl || null : null,
    };
  }

  review(token: string) {
    return this.byReview(token, (tx, id) => this.reviewView(tx, id));
  }

  answerReview(token: string, rating: number, comment: string) {
    return this.byReview(token, async (tx, id) => {
      const [r] = await tx.select().from(reviewRequests).where(eq(reviewRequests.id, id));
      if (r!.answeredAt && r!.createdAt.getTime() < Date.now() - 30 * 86400_000)
        throw new GoneException('Este link não vale mais.');
      const [t] = await tx.select().from(tenants);
      await tx
        .update(reviewRequests)
        .set({
          rating,
          comment,
          answeredAt: new Date(),
          sentToGoogle: rating >= 4 && Boolean(t!.googleReviewUrl),
        })
        .where(eq(reviewRequests.id, id));
      return this.reviewView(tx, id);
    });
  }
}
