import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { pgError, schema, type TenantTx } from '@tagtech/db';
import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { localClock } from '@tagtech/domain';
import type { TenantContext } from '../auth/auth.guard';
import { clinicTimezone } from '../finance/finance.service';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';

const { patients, patientAccessLog, appointments, services, professionals } = schema;

export type PatientFilter = 'all' | 'recall' | 'birthdays' | 'new' | 'site';

export interface PatientInput {
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
  birthDate?: string | null | undefined;
  cpf?: string | null | undefined;
  allergies?: string | undefined;
  medications?: string | undefined;
  notes?: string | undefined;
}

type Patch<T> = { [K in keyof T]?: T[K] | undefined };
type PatientRow = typeof patients.$inferSelect;

export function patientSummary(p: PatientRow) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    birthDate: p.birthDate,
    // Alergia e medicamento aparecem como alerta na agenda, sem abrir a ficha.
    hasAlerts: p.allergies.trim() !== '' || p.medications.trim() !== '',
  };
}

export function patientView(p: PatientRow) {
  return {
    ...patientSummary(p),
    cpf: p.cpf,
    allergies: p.allergies,
    medications: p.medications,
    notes: p.notes,
    source: p.source,
    consentAt: p.consentAt?.toISOString() ?? null,
    contactErasedAt: p.contactErasedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const defined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Normaliza nome para comparar ("Ana  Souza" = "ana souza"). */
const nameKey = (n: string) =>
  n.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Acha o paciente pelo WhatsApp e nome, ou cria. Mãe e filho podem dividir o número,
 * então o telefone sozinho não basta para dizer que é a mesma pessoa.
 */
export async function findOrCreatePatient(
  tx: TenantTx,
  tenantId: string,
  input: {
    name: string;
    phone: string;
    email?: string;
    birthDate?: string | null;
    source: 'staff' | 'online';
    consent: boolean;
  },
): Promise<PatientRow> {
  const samePhone = input.phone
    ? await tx.select().from(patients).where(eq(patients.phone, input.phone))
    : [];
  const match = samePhone.find((p) => nameKey(p.name) === nameKey(input.name));
  if (match) {
    if (input.consent && !match.consentAt) {
      const [updated] = await tx
        .update(patients)
        .set({ consentAt: new Date() })
        .where(eq(patients.id, match.id))
        .returning();
      return updated!;
    }
    return match;
  }
  const [created] = await tx
    .insert(patients)
    .values({
      tenantId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? '',
      birthDate: input.birthDate ?? null,
      source: input.source,
      consentAt: input.consent ? new Date() : null,
    })
    .returning();
  return created!;
}

@Injectable()
export class PatientsService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private log(
    tx: TenantTx,
    ctx: TenantContext,
    patientId: string,
    action: 'view' | 'create' | 'update',
  ) {
    return tx.insert(patientAccessLog).values({
      tenantId: ctx.tenantId,
      patientId,
      actorUserId: ctx.user.userId,
      action,
    });
  }

  /** Busca por nome, telefone ou CPF. Sem termo, os cadastrados mais recentes. */
  search(ctx: TenantContext, q: string, limit: number) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const term = q.trim();
      const digits = term.replace(/\D/g, '');
      const where = term
        ? or(
            ilike(patients.name, `%${term.replace(/[%_\\]/g, '\\$&')}%`),
            digits.length >= 4 ? sql`${patients.phone} like ${`%${digits}%`}` : undefined,
            digits.length === 11 ? eq(patients.cpf, digits) : undefined,
          )
        : undefined;
      const rows = await tx
        .select()
        .from(patients)
        .where(where)
        .orderBy(term ? asc(patients.name) : desc(patients.createdAt))
        .limit(limit);
      return rows.map(patientSummary);
    });
  }

  /**
   * Lista da tela de pacientes com os números do topo e, por paciente, a última visita,
   * a próxima consulta, o total pago e a situação. Retorno vencido: última visita há mais
   * de 6 meses e nada marcado. Total pago não vai para quem atende (sem acesso ao caixa).
   */
  overview(
    ctx: TenantContext,
    o: { q: string; filter: PatientFilter; limit: number; offset: number },
  ) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const mes = Number(localClock(new Date(), await clinicTimezone(tx)).ymd.slice(5, 7));
      const base = sql`
        with ultima as (
          select patient_id, max(starts_at) as em from appointments
          where status = 'done' group by patient_id
        ), proxima as (
          select patient_id, min(starts_at) as em from appointments
          where status in ('scheduled', 'confirmed') and starts_at > now() group by patient_id
        ), gasto as (
          select patient_id, sum(amount_cents)::int as total from charges
          where status = 'paid' and patient_id is not null group by patient_id
        )
        select p.id, p.name, p.phone, p.email, p.cpf, p.birth_date, p.source, p.created_at,
          (btrim(p.allergies) <> '' or btrim(p.medications) <> '') as has_alerts,
          u.em as last_at, x.em as next_at, coalesce(g.total, 0) as spent,
          (select s.name from appointments a join services s on s.id = a.service_id
            where a.patient_id = p.id and a.status = 'done'
            order by a.starts_at desc limit 1) as last_service,
          case
            when x.em is not null then 'scheduled'
            when u.em is null then 'new'
            when u.em < now() - interval '6 months' then 'recall'
            else 'ok'
          end as situation
        from patients p
        left join ultima u on u.patient_id = p.id
        left join proxima x on x.patient_id = p.id
        left join gasto g on g.patient_id = p.id`;
      const term = o.q.trim();
      const digits = term.replace(/\D/g, '');
      const busca = term
        ? sql`(t.name ilike ${`%${term.replace(/[%_\\]/g, '\\$&')}%`}${
            digits.length >= 4 ? sql` or t.phone like ${`%${digits}%`}` : sql``
          }${digits.length === 11 ? sql` or t.cpf = ${digits}` : sql``})`
        : sql`true`;
      const filtro = {
        all: sql`true`,
        recall: sql`situation = 'recall'`,
        birthdays: sql`extract(month from birth_date) = ${mes}`,
        new: sql`created_at > now() - interval '30 days'`,
        site: sql`source = 'online'`,
      }[o.filter];
      const linhas = await tx.execute<{
        id: string;
        name: string;
        phone: string;
        email: string;
        birth_date: string | null;
        has_alerts: boolean;
        last_at: Date | null;
        next_at: Date | null;
        spent: number;
        last_service: string | null;
        situation: 'scheduled' | 'new' | 'recall' | 'ok';
      }>(sql`select * from (${base}) t where ${busca} and ${filtro}
        order by ${o.filter === 'recall' ? sql`last_at asc` : sql`last_at desc nulls last, name asc`}
        limit ${o.limit} offset ${o.offset}`);
      const [n] = await tx.execute<{
        total: number;
        novos: number;
        recall: number;
        site: number;
        aniversarios: number;
      }>(sql`select count(*)::int as total,
          count(*) filter (where created_at > now() - interval '30 days')::int as novos,
          count(*) filter (where situation = 'recall')::int as recall,
          count(*) filter (where source = 'online')::int as site,
          count(*) filter (where extract(month from birth_date) = ${mes})::int as aniversarios
        from (${base}) t`);
      const [filtrados] = await tx.execute<{ c: number }>(
        sql`select count(*)::int as c from (${base}) t where ${busca} and ${filtro}`,
      );
      const caixa = ctx.membership.role !== 'professional';
      const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
      return {
        stats: {
          total: n!.total,
          newLast30: n!.novos,
          recallOverdue: n!.recall,
          fromSite: n!.site,
          birthdaysThisMonth: n!.aniversarios,
        },
        count: filtrados!.c,
        rows: linhas.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          birthDate: r.birth_date,
          hasAlerts: r.has_alerts,
          lastVisit: r.last_at ? { at: iso(r.last_at)!, service: r.last_service ?? '' } : null,
          nextAppointment: iso(r.next_at),
          totalSpentCents: caixa ? r.spent : null,
          situation: r.situation,
        })),
      };
    });
  }

  create(ctx: TenantContext, input: PatientInput) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(patients)
        .values({
          tenantId: ctx.tenantId,
          source: 'staff',
          ...defined({ ...input }),
          name: input.name,
        })
        .returning()
        .catch((e) => this.mapError(e));
      await this.log(tx, ctx, row!.id, 'create');
      return patientView(row!);
    });
  }

  /** Ficha completa com o histórico de consultas. Cada abertura fica registrada. */
  get(ctx: TenantContext, id: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [row] = await tx.select().from(patients).where(eq(patients.id, id));
      if (!row) throw new NotFoundException('Paciente não encontrado');
      await this.log(tx, ctx, id, 'view');
      const history = await tx
        .select({
          id: appointments.id,
          startsAt: appointments.startsAt,
          status: appointments.status,
          serviceName: services.name,
          professionalName: professionals.name,
        })
        .from(appointments)
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
        .where(eq(appointments.patientId, id))
        .orderBy(desc(appointments.startsAt))
        .limit(100);
      return {
        ...patientView(row),
        appointments: history.map((h) => ({ ...h, startsAt: h.startsAt.toISOString() })),
      };
    });
  }

  update(ctx: TenantContext, id: string, input: Patch<PatientInput>) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [row] = await tx
        .update(patients)
        // Voltou a dar contato: o pedido de exclusão anterior deixa de valer.
        .set({
          ...defined({ ...input }),
          ...(input.phone || input.email ? { contactErasedAt: null } : {}),
        })
        .where(eq(patients.id, id))
        .returning()
        .catch((e) => this.mapError(e));
      if (!row) throw new NotFoundException('Paciente não encontrado');
      await this.log(tx, ctx, id, 'update');
      return patientView(row);
    });
  }

  /** Quem abriu ou alterou a ficha (LGPD). Só dono e gerente. */
  accessLog(ctx: TenantContext, id: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(patientAccessLog)
        .where(eq(patientAccessLog.patientId, id))
        .orderBy(desc(patientAccessLog.createdAt))
        .limit(200);
      return rows.map((r) => ({
        action: r.action,
        actorUserId: r.actorUserId,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /**
   * Importa pacientes de outro sistema ou planilha. Quem já existe (mesmo WhatsApp e
   * nome, ou mesmo CPF) é pulado. Devolve quantos entraram e o que foi pulado.
   */
  import(ctx: TenantContext, rows: PatientInput[]) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const existing = await tx
        .select({ name: patients.name, phone: patients.phone, cpf: patients.cpf })
        .from(patients);
      const seen = new Set(existing.map((p) => `${p.phone}|${nameKey(p.name)}`));
      const cpfs = new Set(existing.flatMap((p) => (p.cpf ? [p.cpf] : [])));
      let created = 0;
      const skipped: Array<{ line: number; name: string; reason: string }> = [];
      for (const [i, row] of rows.entries()) {
        const key = `${row.phone ?? ''}|${nameKey(row.name)}`;
        if (seen.has(key)) {
          skipped.push({ line: i + 1, name: row.name, reason: 'Já cadastrado' });
          continue;
        }
        if (row.cpf && cpfs.has(row.cpf)) {
          skipped.push({ line: i + 1, name: row.name, reason: 'CPF já cadastrado' });
          continue;
        }
        await tx.insert(patients).values({
          tenantId: ctx.tenantId,
          source: 'import',
          ...defined({ ...row }),
          name: row.name,
        });
        seen.add(key);
        if (row.cpf) cpfs.add(row.cpf);
        created++;
      }
      return { created, skipped };
    });
  }

  private mapError(e: unknown): never {
    const { code, constraint } = pgError(e);
    if (code === '23505' && constraint === 'patients_unique_cpf') {
      throw new ConflictException('Já existe um paciente com este CPF');
    }
    throw e;
  }
}
