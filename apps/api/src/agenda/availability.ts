import { schema, type TenantTx } from '@tagtech/db';
import {
  BLOCKING_STATUSES,
  freeSlots,
  fromMinutes,
  weekdayOf,
  zonedToUtc,
  type Interval,
} from '@tagtech/domain';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

const {
  appointments,
  professionals,
  serviceProfessionals,
  services,
  timeOff,
  units,
  workingHours,
} = schema;

export interface AvailabilityQuery {
  serviceId: string;
  date: string; // YYYY-MM-DD no fuso da unidade
  professionalId?: string | undefined;
  unitId?: string | undefined;
  /** Nada antes deste instante (agora + antecedência mínima, no site). */
  notBefore?: Date | undefined;
  /** Só profissionais que aceitam agendamento online. */
  onlineOnly?: boolean | undefined;
  /** Ignora esta consulta ao procurar conflito (remarcação). */
  ignoreAppointmentId?: string | undefined;
  step: number;
}

export interface ProfessionalSlots {
  professionalId: string;
  unitId: string;
  timezone: string;
  /** Horários de início livres, "HH:MM" no fuso da unidade. */
  times: string[];
}

/**
 * Horários livres de um serviço num dia, por profissional e unidade.
 * Junta a semana de trabalho, as consultas que ocupam a agenda e os bloqueios
 * (do profissional, da unidade ou da clínica toda).
 */
export async function availability(
  tx: TenantTx,
  q: AvailabilityQuery,
): Promise<ProfessionalSlots[]> {
  const [service] = await tx.select().from(services).where(eq(services.id, q.serviceId));
  if (!service || !service.active || (q.onlineOnly && !service.onlineBooking)) return [];

  // Quem faz o serviço. Serviço sem ninguém ligado = qualquer profissional ativo.
  const links = await tx
    .select({ id: serviceProfessionals.professionalId })
    .from(serviceProfessionals)
    .where(eq(serviceProfessionals.serviceId, q.serviceId));
  const pros = await tx
    .select()
    .from(professionals)
    .where(
      and(
        eq(professionals.active, true),
        q.onlineOnly ? eq(professionals.onlineBooking, true) : undefined,
        links.length
          ? inArray(
              professionals.id,
              links.map((l) => l.id),
            )
          : undefined,
        q.professionalId ? eq(professionals.id, q.professionalId) : undefined,
      ),
    )
    .orderBy(asc(professionals.position), asc(professionals.name));
  if (!pros.length) return [];
  const proIds = pros.map((p) => p.id);

  const weekday = weekdayOf(q.date);
  const hours = await tx
    .select({
      professionalId: workingHours.professionalId,
      unitId: workingHours.unitId,
      start: workingHours.startMinute,
      end: workingHours.endMinute,
      timezone: units.timezone,
      unitActive: units.active,
    })
    .from(workingHours)
    .innerJoin(units, eq(units.id, workingHours.unitId))
    .where(
      and(
        inArray(workingHours.professionalId, proIds),
        eq(workingHours.weekday, weekday),
        q.unitId ? eq(workingHours.unitId, q.unitId) : undefined,
      ),
    );
  const open = hours.filter((h) => h.unitActive);
  if (!open.length) return [];

  // Janela larga o bastante para qualquer fuso: o dia inteiro, com folga dos dois lados.
  const from = new Date(new Date(`${q.date}T00:00:00Z`).getTime() - 24 * 3600_000);
  const to = new Date(new Date(`${q.date}T00:00:00Z`).getTime() + 48 * 3600_000);
  const busyAppointments = await tx
    .select({
      professionalId: appointments.professionalId,
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
    })
    .from(appointments)
    .where(
      and(
        inArray(appointments.professionalId, proIds),
        inArray(appointments.status, BLOCKING_STATUSES),
        lt(appointments.startsAt, to),
        gt(appointments.endsAt, from),
      ),
    );
  const blocks = await tx
    .select()
    .from(timeOff)
    .where(
      and(
        lt(timeOff.startsAt, to),
        gt(timeOff.endsAt, from),
        or(isNull(timeOff.professionalId), inArray(timeOff.professionalId, proIds)),
      ),
    );

  const result: ProfessionalSlots[] = [];
  const groups = new Map<string, typeof open>();
  for (const h of open) {
    const key = `${h.professionalId}|${h.unitId}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  for (const [key, windows] of groups) {
    const [professionalId, unitId] = key.split('|') as [string, string];
    const timezone = windows[0]!.timezone;
    const midnight = zonedToUtc(q.date, 0, timezone).getTime();
    const toMinute = (d: Date) => Math.round((d.getTime() - midnight) / 60_000);
    const busy: Interval[] = [
      ...busyAppointments
        .filter((a) => a.professionalId === professionalId && a.id !== q.ignoreAppointmentId)
        .map((a) => ({ start: toMinute(a.startsAt), end: toMinute(a.endsAt) })),
      ...blocks
        .filter(
          (b) =>
            (b.professionalId === null || b.professionalId === professionalId) &&
            (b.unitId === null || b.unitId === unitId),
        )
        .map((b) => ({ start: toMinute(b.startsAt), end: toMinute(b.endsAt) })),
    ];
    const times = freeSlots({
      windows: windows.map((w) => ({ start: w.start, end: w.end })),
      busy,
      duration: service.durationMinutes,
      step: q.step,
      ...(q.notBefore ? { notBefore: Math.ceil(toMinute(q.notBefore)) } : {}),
    });
    if (times.length)
      result.push({ professionalId, unitId, timezone, times: times.map(fromMinutes) });
  }
  // Ordem estável: a dos profissionais na clínica.
  const order = new Map(pros.map((p, i) => [p.id, i]));
  return result.sort(
    (a, b) => (order.get(a.professionalId) ?? 0) - (order.get(b.professionalId) ?? 0),
  );
}
