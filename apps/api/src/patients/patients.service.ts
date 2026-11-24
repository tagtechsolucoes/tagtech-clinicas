import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { pgError, schema, type TenantTx } from '@tagtech/db';
import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';

const { patients, patientAccessLog, appointments, services, professionals } = schema;

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
        .set(defined({ ...input }))
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
