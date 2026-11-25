import { GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateToken, resolveTvToken, schema, withTenant, type TenantTx } from '@tagtech/db';
import { localClock, zonedToUtc, addDays } from '@tagtech/domain';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { clinicView } from '../clinic/clinic.service';
import { inClinic } from '../common/clinic-scope';
import { hashToken } from '../common/token';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const {
  appointmentEvents,
  appointments,
  patientCalls,
  patients,
  professionals,
  rooms,
  services,
  tenants,
} = schema;

/** "Beatriz Albuquerque" -> "Beatriz A." (a TV fica na sala de espera). */
export const nomeNaTv = (nome: string) => {
  const partes = nome.trim().split(/\s+/);
  return partes.length > 1
    ? `${partes[0]} ${partes[partes.length - 1]![0]!.toUpperCase()}.`
    : partes[0]!;
};

/** Recepção: fila do dia e chamada do paciente na TV da sala de espera. */
@Injectable()
export class ReceptionService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  /** Quem está esperando (com tempo de espera), em atendimento, atrasado e o que vem. */
  queue(ctx: TenantContext, now = new Date()) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const hoje = localClock(now, tz).ymd;
      const de = zonedToUtc(hoje, 0, tz);
      const ate = zonedToUtc(addDays(hoje, 1), 0, tz);
      const rows = await tx
        .select({
          a: appointments,
          patientName: patients.name,
          serviceName: services.name,
          professionalName: professionals.name,
          roomName: rooms.name,
        })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
        .leftJoin(rooms, eq(rooms.id, appointments.roomId))
        .where(
          and(
            gte(appointments.startsAt, de),
            lt(appointments.startsAt, ate),
            inArray(appointments.status, ['scheduled', 'confirmed', 'arrived', 'in_progress']),
          ),
        )
        .orderBy(asc(appointments.startsAt));
      const ids = rows.map((r) => r.a.id);
      const chegadas = ids.length
        ? await tx
            .select({ id: appointmentEvents.appointmentId, at: appointmentEvents.createdAt })
            .from(appointmentEvents)
            .where(
              and(
                inArray(appointmentEvents.appointmentId, ids),
                eq(appointmentEvents.toStatus, 'arrived'),
              ),
            )
            .orderBy(desc(appointmentEvents.createdAt))
        : [];
      const chamadas = ids.length
        ? await tx
            .select({ id: patientCalls.appointmentId, at: patientCalls.createdAt })
            .from(patientCalls)
            .where(inArray(patientCalls.appointmentId, ids))
            .orderBy(desc(patientCalls.createdAt))
        : [];
      const item = (r: (typeof rows)[number]) => ({
        id: r.a.id,
        status: r.a.status,
        startsAt: r.a.startsAt.toISOString(),
        patientId: r.a.patientId,
        patientName: r.patientName,
        serviceName: r.serviceName,
        professionalName: r.professionalName,
        roomName: r.roomName,
        arrivedAt: chegadas.find((c) => c.id === r.a.id)?.at.toISOString() ?? null,
        lastCalledAt: chamadas.find((c) => c.id === r.a.id)?.at.toISOString() ?? null,
      });
      const todos = rows.map(item);
      return {
        waiting: todos
          .filter((x) => x.status === 'arrived')
          .sort((x, y) => (x.arrivedAt ?? '').localeCompare(y.arrivedAt ?? '')),
        inProgress: todos.filter((x) => x.status === 'in_progress'),
        late: todos.filter(
          (x) => ['scheduled', 'confirmed'].includes(x.status) && new Date(x.startsAt) < now,
        ),
        next: todos.filter(
          (x) => ['scheduled', 'confirmed'].includes(x.status) && new Date(x.startsAt) >= now,
        ),
      };
    });
  }

  /** Chama o paciente na TV: primeiro nome e inicial, e para onde ir. */
  call(ctx: TenantContext, appointmentId: string, destination?: string) {
    return this.run(ctx, async (tx) => {
      const [r] = await tx
        .select({ a: appointments, name: patients.name, pro: professionals.name, room: rooms.name })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
        .leftJoin(rooms, eq(rooms.id, appointments.roomId))
        .where(eq(appointments.id, appointmentId));
      if (!r) throw new NotFoundException('Consulta não encontrada');
      const [c] = await tx
        .insert(patientCalls)
        .values({
          tenantId: ctx.tenantId,
          appointmentId,
          displayName: nomeNaTv(r.name),
          destination: (destination?.trim() || r.room || r.pro).slice(0, 80),
          calledBy: ctx.user.userId,
        })
        .returning();
      return { id: c!.id, displayName: c!.displayName, destination: c!.destination };
    });
  }

  /** Link novo para a TV (o anterior para de funcionar). */
  newTvLink(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const token = generateToken();
      await tx
        .update(tenants)
        .set({ tvTokenHash: hashToken(token) })
        .where(eq(tenants.id, ctx.tenantId));
      return { token };
    });
  }

  /** O que a TV mostra: só as chamadas de hoje, sem nada além do nome curto. */
  async tv(token: string) {
    const tenantId = await resolveTvToken(this.dbService.db, hashToken(token));
    if (!tenantId)
      throw new GoneException('Esta TV foi desconectada. Gere um link novo no painel.');
    return withTenant(this.dbService.db, tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants);
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(localClock(new Date(), tz).ymd, 0, tz);
      const calls = await tx
        .select()
        .from(patientCalls)
        .where(gte(patientCalls.createdAt, de))
        .orderBy(desc(patientCalls.createdAt))
        .limit(6);
      const { booking: _b, about: _a, ...brand } = clinicView(t!);
      return {
        clinic: brand,
        timezone: tz,
        calls: calls.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          destination: c.destination,
          at: c.createdAt.toISOString(),
        })),
      };
    });
  }
}
