import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateToken, memberNames, pgError, schema, type TenantTx } from '@tagtech/db';
import {
  canTransition,
  localClock,
  STATUS_LABELS,
  weekdayOf,
  zonedToUtc,
  type AppointmentStatus,
} from '@tagtech/domain';
import { and, asc, eq, gte, gt, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { recordAudit } from '../audit/audit';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { findOrCreatePatient, patientSummary } from '../patients/patients.service';
import { availability } from './availability';
import { hashToken } from '../common/token';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const {
  appointments,
  appointmentEvents,
  patients,
  professionals,
  rooms,
  services,
  tenants,
  timeOff,
  units,
  waitlist,
  workingHours,
} = schema;

type AppointmentRow = typeof appointments.$inferSelect;

/** Consultas com serviço, profissional e paciente, prontas para a tela. */
export async function loadAppointments(tx: TenantTx, where: ReturnType<typeof and>) {
  const rows = await tx
    .select({
      a: appointments,
      service: { id: services.id, name: services.name, color: services.color },
      professional: { id: professionals.id, name: professionals.name, color: professionals.color },
      patient: patients,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(where)
    .orderBy(asc(appointments.startsAt));
  return rows.map(({ a, service, professional, patient }) => ({
    id: a.id,
    unitId: a.unitId,
    roomId: a.roomId,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    source: a.source,
    priceCents: a.priceCents,
    notes: a.notes,
    cancelReason: a.cancelReason,
    confirmedAt: a.confirmedAt?.toISOString() ?? null,
    service,
    professional,
    patient: patientSummary(patient),
  }));
}

export type AppointmentView = Awaited<ReturnType<typeof loadAppointments>>[number];

export interface BookInput {
  patientId?: string | undefined;
  patient?: { name: string; phone: string } | undefined;
  serviceId: string;
  professionalId: string;
  unitId?: string | undefined;
  roomId?: string | null | undefined;
  startsAt: Date;
  durationMinutes?: number | undefined;
  priceCents?: number | null | undefined;
  notes?: string | undefined;
  /** Encaixe: aceita fora da semana de trabalho (conflito com outra consulta nunca). */
  allowOutsideHours?: boolean | undefined;
}

export interface ReschedulePatch {
  startsAt?: Date | undefined;
  professionalId?: string | undefined;
  roomId?: string | null | undefined;
  notes?: string | undefined;
  priceCents?: number | null | undefined;
  allowOutsideHours?: boolean | undefined;
}

/** Erro de horário ocupado (garantido pelo banco) vira 409 com mensagem clara. */
export function mapBookingError(e: unknown): never {
  const { code, constraint } = pgError(e);
  if (code === '23P01' && constraint === 'appointments_professional_free') {
    throw new ConflictException('Este profissional já tem consulta neste horário');
  }
  if (code === '23P01' && constraint === 'appointments_room_free') {
    throw new ConflictException('Esta sala já está ocupada neste horário');
  }
  if (code === '23503')
    throw new NotFoundException('Paciente, serviço, sala ou profissional não encontrado');
  throw e;
}

@Injectable()
export class AgendaService {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  /** Consultas e bloqueios entre duas datas, para a grade da agenda. */
  agenda(ctx: TenantContext, from: Date, to: Date, unitId?: string) {
    return this.run(ctx, async (tx) => {
      const list = await loadAppointments(
        tx,
        and(
          lt(appointments.startsAt, to),
          gt(appointments.endsAt, from),
          unitId ? eq(appointments.unitId, unitId) : undefined,
        ),
      );
      const blocks = await tx
        .select()
        .from(timeOff)
        .where(
          and(
            lt(timeOff.startsAt, to),
            gt(timeOff.endsAt, from),
            unitId ? or(isNull(timeOff.unitId), eq(timeOff.unitId, unitId)) : undefined,
          ),
        );
      return {
        appointments: list,
        timeOff: blocks.map((b) => ({
          id: b.id,
          professionalId: b.professionalId,
          unitId: b.unitId,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          reason: b.reason,
        })),
      };
    });
  }

  /** Horários livres para a recepção (sem antecedência mínima). */
  slots(
    ctx: TenantContext,
    q: {
      serviceId: string;
      date: string;
      professionalId?: string | undefined;
      unitId?: string | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const [tenant] = await tx.select().from(tenants);
      return availability(tx, { ...q, step: tenant!.slotStepMinutes, notBefore: new Date() });
    });
  }

  /** Confere se o horário cabe na semana de trabalho e fora dos bloqueios. */
  private async assertWithinHours(
    tx: TenantTx,
    professionalId: string,
    unitId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const [unit] = await tx.select().from(units).where(eq(units.id, unitId));
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    const start = localClock(startsAt, unit.timezone);
    const midnight = zonedToUtc(start.ymd, 0, unit.timezone).getTime();
    const s = Math.round((startsAt.getTime() - midnight) / 60_000);
    const e = Math.round((endsAt.getTime() - midnight) / 60_000);
    const windows = await tx
      .select()
      .from(workingHours)
      .where(
        and(
          eq(workingHours.professionalId, professionalId),
          eq(workingHours.unitId, unitId),
          eq(workingHours.weekday, weekdayOf(start.ymd)),
        ),
      );
    if (!windows.some((w) => w.startMinute <= s && e <= w.endMinute)) {
      throw new ConflictException({
        message: 'Fora do horário de trabalho do profissional. Marque como encaixe para confirmar.',
        reason: 'outside_hours',
      });
    }
    const [block] = await tx
      .select()
      .from(timeOff)
      .where(
        and(
          lt(timeOff.startsAt, endsAt),
          gt(timeOff.endsAt, startsAt),
          or(isNull(timeOff.professionalId), eq(timeOff.professionalId, professionalId)),
          or(isNull(timeOff.unitId), eq(timeOff.unitId, unitId)),
        ),
      )
      .limit(1);
    if (block) {
      throw new ConflictException({
        message: `Horário bloqueado${block.reason ? `: ${block.reason}` : ''}. Marque como encaixe para confirmar.`,
        reason: 'time_off',
      });
    }
  }

  /** Unidade em que o profissional atende naquele dia; sem turno, a primeira ativa. */
  private async pickUnit(tx: TenantTx, professionalId: string, startsAt: Date): Promise<string> {
    const all = await tx
      .select()
      .from(units)
      .where(eq(units.active, true))
      .orderBy(asc(units.createdAt));
    if (!all.length) throw new BadRequestException('Cadastre uma unidade antes de agendar');
    for (const u of all) {
      const day = weekdayOf(localClock(startsAt, u.timezone).ymd);
      const [h] = await tx
        .select({ id: workingHours.id })
        .from(workingHours)
        .where(
          and(
            eq(workingHours.professionalId, professionalId),
            eq(workingHours.unitId, u.id),
            eq(workingHours.weekday, day),
          ),
        )
        .limit(1);
      if (h) return u.id;
    }
    return all[0]!.id;
  }

  async book(ctx: TenantContext, input: BookInput) {
    const booked = await this.run(ctx, async (tx) => {
      const [service] = await tx.select().from(services).where(eq(services.id, input.serviceId));
      if (!service) throw new NotFoundException('Serviço não encontrado');
      const [pro] = await tx
        .select()
        .from(professionals)
        .where(eq(professionals.id, input.professionalId));
      if (!pro || !pro.active) throw new NotFoundException('Profissional não encontrado');

      let patientId = input.patientId;
      if (!patientId) {
        if (!input.patient) throw new BadRequestException('Escolha o paciente');
        const created = await findOrCreatePatient(tx, ctx.tenantId, {
          ...input.patient,
          source: 'staff',
          consent: false,
        });
        patientId = created.id;
      } else {
        const [p] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(eq(patients.id, patientId));
        if (!p) throw new NotFoundException('Paciente não encontrado');
      }

      const unitId = input.unitId ?? (await this.pickUnit(tx, pro.id, input.startsAt));
      const endsAt = new Date(
        input.startsAt.getTime() + (input.durationMinutes ?? service.durationMinutes) * 60_000,
      );
      if (input.roomId) await this.assertRoom(tx, input.roomId, unitId);
      if (!input.allowOutsideHours)
        await this.assertWithinHours(tx, pro.id, unitId, input.startsAt, endsAt);

      const token = generateToken();
      const [row] = await tx
        .insert(appointments)
        .values({
          tenantId: ctx.tenantId,
          unitId,
          professionalId: pro.id,
          roomId: input.roomId ?? null,
          serviceId: service.id,
          patientId,
          startsAt: input.startsAt,
          endsAt,
          source: 'staff',
          priceCents: input.priceCents !== undefined ? input.priceCents : service.priceCents,
          notes: input.notes ?? '',
          manageTokenHash: hashToken(token),
          createdBy: ctx.user.userId,
        })
        .returning()
        .catch(mapBookingError);
      await tx.insert(appointmentEvents).values({
        tenantId: ctx.tenantId,
        appointmentId: row!.id,
        toStatus: 'scheduled',
        actorUserId: ctx.user.userId,
      });
      const [view] = await loadAppointments(tx, eq(appointments.id, row!.id));
      return { ...view!, manageToken: token };
    });
    this.whatsapp.appointmentEvent(ctx.tenantId, booked.id, 'booked', booked.manageToken);
    return booked;
  }

  private async assertRoom(tx: TenantTx, roomId: string, unitId: string) {
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
    if (!room || !room.active) throw new NotFoundException('Sala não encontrada');
    if (room.unitId !== unitId) throw new BadRequestException('A sala é de outra unidade');
  }

  private async current(tx: TenantTx, id: string): Promise<AppointmentRow> {
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
    if (!row) throw new NotFoundException('Consulta não encontrada');
    return row;
  }

  /** Remarca (horário, profissional, sala) ou ajusta observação e preço. */
  async update(ctx: TenantContext, id: string, patch: ReschedulePatch) {
    let moved = false;
    const view = await this.run(ctx, async (tx) => {
      const before = await this.current(tx, id);
      const moving =
        (patch.startsAt && patch.startsAt.getTime() !== before.startsAt.getTime()) ||
        (patch.professionalId && patch.professionalId !== before.professionalId);
      if (moving && !['scheduled', 'confirmed'].includes(before.status)) {
        throw new ConflictException('Só dá para remarcar consulta agendada ou confirmada');
      }
      const startsAt = patch.startsAt ?? before.startsAt;
      const endsAt = new Date(
        startsAt.getTime() + (before.endsAt.getTime() - before.startsAt.getTime()),
      );
      const professionalId = patch.professionalId ?? before.professionalId;
      const roomId = patch.roomId !== undefined ? patch.roomId : before.roomId;
      if (patch.professionalId) {
        const [pro] = await tx
          .select()
          .from(professionals)
          .where(eq(professionals.id, professionalId));
        if (!pro || !pro.active) throw new NotFoundException('Profissional não encontrado');
      }
      if (roomId && roomId !== before.roomId) await this.assertRoom(tx, roomId, before.unitId);
      if (moving && !patch.allowOutsideHours) {
        await this.assertWithinHours(tx, professionalId, before.unitId, startsAt, endsAt);
      }
      await tx
        .update(appointments)
        .set({
          startsAt,
          endsAt,
          professionalId,
          roomId,
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.priceCents !== undefined ? { priceCents: patch.priceCents } : {}),
          // Remarcou: a confirmação antiga não vale para o horário novo.
          ...(moving ? { status: 'scheduled' as const, confirmedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, id))
        .catch(mapBookingError);
      moved = Boolean(moving);
      if (moving) {
        await tx.insert(appointmentEvents).values({
          tenantId: ctx.tenantId,
          appointmentId: id,
          fromStatus: before.status,
          toStatus: 'scheduled',
          fromStartsAt: before.startsAt,
          actorUserId: ctx.user.userId,
          reason: 'Remarcada',
        });
      }
      return (await loadAppointments(tx, eq(appointments.id, id)))[0]!;
    });
    if (moved) this.whatsapp.appointmentEvent(ctx.tenantId, id, 'rescheduled');
    return view;
  }

  async setStatus(ctx: TenantContext, id: string, status: AppointmentStatus, reason?: string) {
    let changed = false;
    const view = await this.run(ctx, async (tx) => {
      const before = await this.current(tx, id);
      if (before.status === status)
        return (await loadAppointments(tx, eq(appointments.id, id)))[0]!;
      if (!canTransition(before.status, status)) {
        throw new ConflictException(
          `Não dá para passar de "${STATUS_LABELS[before.status]}" para "${STATUS_LABELS[status]}"`,
        );
      }
      if (status === 'cancelled' && (!reason || reason.trim().length < 3)) {
        throw new BadRequestException('Informe o motivo do cancelamento');
      }
      await tx
        .update(appointments)
        .set({
          status,
          cancelReason: status === 'cancelled' ? reason!.trim() : null,
          ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, id))
        // Desfazer falta pode bater em consulta marcada no horário que ficou livre.
        .catch(mapBookingError);
      await tx.insert(appointmentEvents).values({
        tenantId: ctx.tenantId,
        appointmentId: id,
        fromStatus: before.status,
        toStatus: status,
        actorUserId: ctx.user.userId,
        reason: reason?.trim() || null,
      });
      changed = true;
      if (status === 'cancelled') {
        await recordAudit(tx, ctx, {
          unitId: before.unitId,
          action: 'appointment.cancelled',
          summary: `Consulta cancelada: ${reason!.trim()}`,
          details: { appointmentId: id },
        });
      }
      return (await loadAppointments(tx, eq(appointments.id, id)))[0]!;
    });
    if (changed && status === 'cancelled')
      this.whatsapp.appointmentEvent(ctx.tenantId, id, 'cancelled');
    return view;
  }

  /** Link novo para o paciente confirmar ou desmarcar (o anterior deixa de valer). */
  newManageLink(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      await this.current(tx, id);
      const token = generateToken();
      await tx
        .update(appointments)
        .set({ manageTokenHash: hashToken(token) })
        .where(eq(appointments.id, id));
      return { token };
    });
  }

  history(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      await this.current(tx, id);
      const rows = await tx
        .select()
        .from(appointmentEvents)
        .where(eq(appointmentEvents.appointmentId, id))
        .orderBy(asc(appointmentEvents.createdAt));
      const names = await memberNames(tx, [
        ...new Set(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : []))),
      ]);
      return rows.map((r) => ({
        from: r.fromStatus,
        to: r.toStatus,
        fromStartsAt: r.fromStartsAt?.toISOString() ?? null,
        reason: r.reason,
        actor:
          r.actorKind === 'patient'
            ? 'Paciente'
            : r.actorKind === 'system'
              ? 'Sistema'
              : r.actorUserId
                ? (names.get(r.actorUserId) ?? 'Pessoa removida')
                : 'Equipe',
        at: r.createdAt.toISOString(),
      }));
    });
  }

  // ------------------------------------------------------------ lista de espera

  listWaitlist(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({ w: waitlist, patient: patients, serviceName: services.name })
        .from(waitlist)
        .innerJoin(patients, eq(patients.id, waitlist.patientId))
        .innerJoin(services, eq(services.id, waitlist.serviceId))
        .where(inArray(waitlist.status, ['waiting', 'offered']))
        .orderBy(asc(waitlist.createdAt));
      return rows.map(({ w, patient, serviceName }) => waitlistView(w, patient, serviceName));
    });
  }

  addToWaitlist(
    ctx: TenantContext,
    input: {
      patientId: string;
      serviceId: string;
      professionalId: string | null;
      unitId: string | null;
      fromDate: string;
      toDate: string;
      period: 'any' | 'morning' | 'afternoon' | 'evening';
      notes: string;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .insert(waitlist)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning()
        .catch((e) => {
          if (pgError(e).code === '23503')
            throw new NotFoundException('Paciente, serviço ou profissional não encontrado');
          throw e;
        });
      const [patient] = await tx.select().from(patients).where(eq(patients.id, row!.patientId));
      const [service] = await tx.select().from(services).where(eq(services.id, row!.serviceId));
      return waitlistView(row!, patient!, service!.name);
    });
  }

  setWaitlistStatus(
    ctx: TenantContext,
    id: string,
    status: 'waiting' | 'offered' | 'booked' | 'cancelled',
    appointmentId?: string,
  ) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(waitlist)
        .set({ status, ...(appointmentId ? { bookedAppointmentId: appointmentId } : {}) })
        .where(eq(waitlist.id, id))
        .returning();
      if (!row) throw new NotFoundException('Pedido da lista de espera não encontrado');
      return { id: row.id, status: row.status };
    });
  }

  /**
   * Quem da lista de espera cabe no horário desta consulta (normalmente uma que acabou
   * de ser cancelada): mesmo serviço, profissional aceito, data e período combinando.
   */
  waitlistMatches(ctx: TenantContext, appointmentId: string) {
    return this.run(ctx, async (tx) => {
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
      if (!a) throw new NotFoundException('Consulta não encontrada');
      const [unit] = await tx.select().from(units).where(eq(units.id, a.unitId));
      const local = localClock(a.startsAt, unit!.timezone);
      const period =
        local.minute < 12 * 60 ? 'morning' : local.minute < 18 * 60 ? 'afternoon' : 'evening';
      const rows = await tx
        .select({ w: waitlist, patient: patients, serviceName: services.name })
        .from(waitlist)
        .innerJoin(patients, eq(patients.id, waitlist.patientId))
        .innerJoin(services, eq(services.id, waitlist.serviceId))
        .where(
          and(
            eq(waitlist.status, 'waiting'),
            eq(waitlist.serviceId, a.serviceId),
            or(isNull(waitlist.professionalId), eq(waitlist.professionalId, a.professionalId)),
            or(isNull(waitlist.unitId), eq(waitlist.unitId, a.unitId)),
            lte(waitlist.fromDate, local.ymd),
            gte(waitlist.toDate, local.ymd),
            inArray(waitlist.period, ['any', period]),
          ),
        )
        .orderBy(asc(waitlist.createdAt));
      return rows.map(({ w, patient, serviceName }) => waitlistView(w, patient, serviceName));
    });
  }
}

function waitlistView(
  w: typeof waitlist.$inferSelect,
  patient: typeof patients.$inferSelect,
  serviceName: string,
) {
  return {
    id: w.id,
    status: w.status,
    serviceId: w.serviceId,
    serviceName,
    professionalId: w.professionalId,
    unitId: w.unitId,
    fromDate: w.fromDate,
    toDate: w.toDate,
    period: w.period,
    notes: w.notes,
    patient: patientSummary(patient),
    createdAt: w.createdAt.toISOString(),
  };
}
