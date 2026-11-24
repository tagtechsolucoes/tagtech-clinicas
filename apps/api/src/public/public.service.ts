import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  generateToken,
  resolveAppointmentToken,
  resolveClinicSlug,
  schema,
  withTenant,
  type TenantTx,
} from '@tagtech/db';
import { addDays, canTransition, localClock, toMinutes, zonedToUtc } from '@tagtech/domain';
import { and, asc, eq } from 'drizzle-orm';
import { AttemptLimiter } from '../common/attempt-limiter';
import { DbService } from '../db/db.module';
import { availability, type ProfessionalSlots } from '../agenda/availability';
import { mapBookingError } from '../agenda/agenda.service';
import { hashToken } from '../common/token';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { clinicView } from '../clinic/clinic.service';
import { loadProfessionals, loadServices } from '../clinic/clinic.service';
import { findOrCreatePatient } from '../patients/patients.service';

const { appointments, appointmentEvents, patients, professionals, services, tenants, units } =
  schema;

export interface PublicBooking {
  serviceId: string;
  professionalId?: string | undefined;
  unitId?: string | undefined;
  date: string;
  time: string;
  name: string;
  phone: string;
  email?: string | undefined;
  birthDate?: string | null | undefined;
  notes?: string | undefined;
}

/** Site de agendamento e link do paciente. Nada aqui precisa de login. */
@Injectable()
export class PublicService {
  // Um mesmo IP não marca mais que 12 consultas por hora (evita encher a agenda de lixo).
  private readonly bookingLimiter = new AttemptLimiter({
    maxFailures: 12,
    windowMs: 60 * 60 * 1000,
    message: 'Muitos agendamentos seguidos. Tente de novo mais tarde ou fale com a clínica.',
  });

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {}

  private async clinic<T>(
    slug: string,
    fn: (tx: TenantTx, tenant: typeof tenants.$inferSelect) => Promise<T>,
  ) {
    const tenantId = await resolveClinicSlug(this.dbService.db, slug);
    if (!tenantId) throw new NotFoundException('Clínica não encontrada');
    return withTenant(this.dbService.db, tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants);
      return fn(tx, tenant!);
    });
  }

  /** Tudo que a página da clínica mostra: marca, unidades, profissionais e serviços. */
  info(slug: string) {
    return this.clinic(slug, async (tx, tenant) => {
      const unitRows = await tx
        .select()
        .from(units)
        .where(eq(units.active, true))
        .orderBy(asc(units.createdAt));
      const pros = (await loadProfessionals(tx)).filter((p) => p.active && p.onlineBooking);
      const svc = (await loadServices(tx)).filter((s) => s.active && s.onlineBooking);
      const proIds = new Set(pros.map((p) => p.id));
      const { booking, ...view } = clinicView(tenant);
      return {
        ...view,
        booking: { enabled: booking.enabled, horizonDays: booking.horizonDays },
        units: unitRows.map((u) => ({
          id: u.id,
          name: u.name,
          address: u.address,
          phone: u.phone,
          timezone: u.timezone,
        })),
        professionals: pros.map((p) => ({
          id: p.id,
          name: p.name,
          specialty: p.specialty,
          council: p.council,
          bio: p.bio,
          photoUrl: p.photoUrl,
          serviceIds: p.serviceIds,
        })),
        services: svc.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
          // Sem ninguém ligado ao serviço, qualquer profissional online atende.
          professionalIds: s.professionalIds.length
            ? s.professionalIds.filter((id) => proIds.has(id))
            : [...proIds],
        })),
      };
    });
  }

  private query(
    tenant: typeof tenants.$inferSelect,
    q: {
      serviceId: string;
      date: string;
      professionalId?: string | undefined;
      unitId?: string | undefined;
    },
  ) {
    return {
      ...q,
      step: tenant.slotStepMinutes,
      onlineOnly: true,
      notBefore: new Date(Date.now() + tenant.bookingMinNoticeMinutes * 60_000),
    };
  }

  private assertBookable(
    tenant: typeof tenants.$inferSelect,
    date: string,
    timezone = 'America/Recife',
  ) {
    if (!tenant.bookingEnabled)
      throw new ConflictException('A clínica não está agendando pelo site agora');
    const today = localClock(new Date(), timezone).ymd;
    if (date < today || date > addDays(today, tenant.bookingHorizonDays)) {
      throw new BadRequestException('Escolha uma data dentro do período de agendamento');
    }
  }

  /** Horários livres de um dia. */
  slots(
    slug: string,
    q: {
      serviceId: string;
      date: string;
      professionalId?: string | undefined;
      unitId?: string | undefined;
    },
  ) {
    return this.clinic(slug, async (tx, tenant) => {
      if (!tenant.bookingEnabled) return [];
      const today = localClock(new Date(), 'America/Recife').ymd;
      if (q.date < addDays(today, -1) || q.date > addDays(today, tenant.bookingHorizonDays))
        return [];
      return availability(tx, this.query(tenant, q));
    });
  }

  /** Quais dos próximos dias têm algum horário (para marcar o calendário). */
  days(
    slug: string,
    q: {
      serviceId: string;
      from: string;
      days: number;
      professionalId?: string | undefined;
      unitId?: string | undefined;
    },
  ) {
    return this.clinic(slug, async (tx, tenant) => {
      const out: Array<{ date: string; count: number }> = [];
      if (!tenant.bookingEnabled) return out;
      const today = localClock(new Date(), 'America/Recife').ymd;
      const last = addDays(today, tenant.bookingHorizonDays);
      for (let i = 0; i < q.days; i++) {
        const date = addDays(q.from, i);
        if (date < today || date > last) {
          out.push({ date, count: 0 });
          continue;
        }
        const found = await availability(tx, this.query(tenant, { ...q, date }));
        out.push({ date, count: new Set(found.flatMap((f) => f.times)).size });
      }
      return out;
    });
  }

  async book(slug: string, input: PublicBooking, ip: string) {
    this.bookingLimiter.assertAllowed(ip, slug);
    const result = await this.clinic(slug, async (tx, tenant) => {
      this.assertBookable(tenant, input.date);
      const free: ProfessionalSlots[] = await availability(
        tx,
        this.query(tenant, {
          serviceId: input.serviceId,
          date: input.date,
          professionalId: input.professionalId,
          unitId: input.unitId,
        }),
      );
      const pick = free.find((f) => f.times.includes(input.time));
      if (!pick) throw new ConflictException('Este horário não está mais livre. Escolha outro.');

      const [service] = await tx.select().from(services).where(eq(services.id, input.serviceId));
      const patient = await findOrCreatePatient(tx, tenant.id, {
        name: input.name,
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
        birthDate: input.birthDate ?? null,
        source: 'online',
        consent: true,
      });
      const startsAt = zonedToUtc(input.date, toMinutes(input.time), pick.timezone);
      const token = generateToken();
      const [row] = await tx
        .insert(appointments)
        .values({
          tenantId: tenant.id,
          unitId: pick.unitId,
          professionalId: pick.professionalId,
          serviceId: service!.id,
          patientId: patient.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + service!.durationMinutes * 60_000),
          source: 'online',
          priceCents: service!.priceCents,
          notes: input.notes ?? '',
          manageTokenHash: hashToken(token),
        })
        .returning()
        .catch((e) => {
          try {
            mapBookingError(e);
          } catch (mapped) {
            if (mapped instanceof ConflictException) {
              throw new ConflictException('Este horário acabou de ser ocupado. Escolha outro.');
            }
            throw mapped;
          }
        });
      await tx.insert(appointmentEvents).values({
        tenantId: tenant.id,
        appointmentId: row!.id,
        toStatus: 'scheduled',
        actorKind: 'patient',
      });
      return { token, tenantId: tenant.id, id: row!.id, view: await this.manageView(tx, row!.id) };
    });
    this.bookingLimiter.recordFailure(ip, slug);
    this.whatsapp.appointmentEvent(result.tenantId, result.id, 'booked', result.token);
    return { token: result.token, appointment: result.view };
  }

  // ------------------------------------------------------------ link do paciente

  private async byToken<T>(token: string, fn: (tx: TenantTx, appointmentId: string) => Promise<T>) {
    const found = await resolveAppointmentToken(this.dbService.db, hashToken(token));
    if (!found) throw new GoneException('Este link não vale mais. Fale com a clínica.');
    return withTenant(this.dbService.db, found.tenantId, (tx) => fn(tx, found.appointmentId));
  }

  private async manageView(tx: TenantTx, appointmentId: string) {
    const [row] = await tx
      .select({
        a: appointments,
        serviceName: services.name,
        professionalName: professionals.name,
        patientName: patients.name,
        unit: units,
        tenant: tenants,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(units, eq(units.id, appointments.unitId))
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .where(eq(appointments.id, appointmentId));
    if (!row) throw new GoneException('Este link não vale mais. Fale com a clínica.');
    const { a, tenant, unit } = row;
    const future = a.startsAt.getTime() > Date.now();
    const { booking: _b, about: _a, ...brand } = clinicView(tenant);
    return {
      clinic: brand,
      unit: { name: unit.name, address: unit.address, phone: unit.phone, timezone: unit.timezone },
      serviceName: row.serviceName,
      professionalName: row.professionalName,
      // Só o primeiro nome: quem abre o link não precisa ver o cadastro.
      patientFirstName: row.patientName.split(' ')[0],
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      status: a.status,
      canConfirm: future && canTransition(a.status, 'confirmed') && a.status === 'scheduled',
      canCancel: future && ['scheduled', 'confirmed'].includes(a.status),
    };
  }

  manage(token: string) {
    return this.byToken(token, (tx, id) => this.manageView(tx, id));
  }

  confirm(token: string) {
    return this.byToken(token, async (tx, id) => {
      const view = await this.manageView(tx, id);
      if (view.status === 'confirmed') return view;
      if (!view.canConfirm)
        throw new ConflictException('Esta consulta não pode mais ser confirmada');
      const [a] = await tx
        .update(appointments)
        .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.status, 'scheduled')))
        .returning();
      if (a) {
        await tx.insert(appointmentEvents).values({
          tenantId: a.tenantId,
          appointmentId: id,
          fromStatus: 'scheduled',
          toStatus: 'confirmed',
          actorKind: 'patient',
        });
      }
      return this.manageView(tx, id);
    });
  }

  cancel(token: string, reason?: string) {
    return this.byToken(token, async (tx, id) => {
      const view = await this.manageView(tx, id);
      if (view.status === 'cancelled') return view;
      if (!view.canCancel)
        throw new ConflictException('Esta consulta não pode mais ser desmarcada pelo link');
      const why =
        reason?.trim() && reason.trim().length >= 3 ? reason.trim() : 'Desmarcada pelo paciente';
      const [before] = await tx.select().from(appointments).where(eq(appointments.id, id));
      await tx
        .update(appointments)
        .set({ status: 'cancelled', cancelReason: why, updatedAt: new Date() })
        .where(eq(appointments.id, id));
      await tx.insert(appointmentEvents).values({
        tenantId: before!.tenantId,
        appointmentId: id,
        fromStatus: before!.status,
        toStatus: 'cancelled',
        actorKind: 'patient',
        reason: why,
      });
      return this.manageView(tx, id);
    });
  }
}
