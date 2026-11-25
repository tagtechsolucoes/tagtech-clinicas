import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { localClock, monthlyDueDates, splitInstallments } from '@tagtech/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const { appointments, charges, patients, services, sessionPackages } = schema;
type Pkg = typeof sessionPackages.$inferSelect;

export interface PackageInput {
  serviceId: string;
  title?: string | undefined;
  totalSessions: number;
  priceCents: number;
  noShowCounts: boolean;
  validUntil?: string | null | undefined;
  notes: string;
  /** Lança o valor no financeiro: à vista ou parcelado. */
  charge?: { installments: number; firstDueDate?: string | undefined } | undefined;
}

/** Sessões usadas (feitas, e faltas se o pacote conta falta) e já marcadas, por pacote. */
export async function packageUsage(tx: TenantTx, ids: string[]) {
  const out = new Map<string, { used: number; booked: number }>();
  if (!ids.length) return out;
  const rows = await tx
    .select({
      packageId: appointments.packageId,
      status: appointments.status,
      n: sql<number>`count(*)::int`,
    })
    .from(appointments)
    .where(inArray(appointments.packageId, ids))
    .groupBy(appointments.packageId, appointments.status);
  const pkgs = await tx
    .select({ id: sessionPackages.id, noShow: sessionPackages.noShowCounts })
    .from(sessionPackages)
    .where(inArray(sessionPackages.id, ids));
  for (const id of ids) out.set(id, { used: 0, booked: 0 });
  for (const r of rows) {
    const u = out.get(r.packageId!)!;
    const conta = pkgs.find((p) => p.id === r.packageId)?.noShow;
    if (r.status === 'done' || (r.status === 'no_show' && conta)) u.used += r.n;
    else if (['scheduled', 'confirmed', 'arrived', 'in_progress'].includes(r.status))
      u.booked += r.n;
  }
  return out;
}

/** Quantas sessões ainda dá para marcar no pacote nesta data. Erro se não serve. */
export async function packageRoom(
  tx: TenantTx,
  packageId: string,
  patientId: string,
  serviceId: string,
): Promise<{ pkg: Pkg; free: number }> {
  const [pkg] = await tx
    .select()
    .from(sessionPackages)
    .where(eq(sessionPackages.id, packageId))
    .for('update');
  if (!pkg) throw new NotFoundException('Pacote não encontrado');
  if (pkg.patientId !== patientId) throw new BadRequestException('O pacote é de outro paciente');
  if (pkg.serviceId !== serviceId) throw new BadRequestException('O pacote é de outro serviço');
  if (pkg.status !== 'active') throw new ConflictException('Este pacote não está ativo');
  const u = (await packageUsage(tx, [pkg.id])).get(pkg.id)!;
  return { pkg, free: pkg.totalSessions - u.used - u.booked };
}

/** Fecha o pacote quando acabou; reabre se desfizeram uma sessão. */
export async function refreshPackage(tx: TenantTx, packageId: string | null) {
  if (!packageId) return;
  const [pkg] = await tx.select().from(sessionPackages).where(eq(sessionPackages.id, packageId));
  if (!pkg || pkg.status === 'cancelled') return;
  const u = (await packageUsage(tx, [pkg.id])).get(pkg.id)!;
  const status = u.used >= pkg.totalSessions ? 'finished' : 'active';
  if (status !== pkg.status)
    await tx.update(sessionPackages).set({ status }).where(eq(sessionPackages.id, pkg.id));
}

@Injectable()
export class PackagesService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  private async views(tx: TenantTx, rows: Array<Pkg & { serviceName: string }>) {
    const uso = await packageUsage(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((p) => {
      const u = uso.get(p.id)!;
      const remaining = p.totalSessions - u.used;
      return {
        id: p.id,
        patientId: p.patientId,
        serviceId: p.serviceId,
        serviceName: p.serviceName,
        title: p.title,
        totalSessions: p.totalSessions,
        used: u.used,
        booked: u.booked,
        remaining,
        // Para marcar: o que sobra tirando o que já está na agenda.
        free: remaining - u.booked,
        endingSoon:
          p.status === 'active' && remaining <= Math.max(2, Math.ceil(p.totalSessions * 0.2)),
        priceCents: p.priceCents,
        noShowCounts: p.noShowCounts,
        validUntil: p.validUntil,
        status: p.status,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  private async load(tx: TenantTx, where: ReturnType<typeof and>) {
    const rows = await tx
      .select({ p: sessionPackages, serviceName: services.name })
      .from(sessionPackages)
      .innerJoin(services, eq(services.id, sessionPackages.serviceId))
      .where(where)
      .orderBy(desc(sessionPackages.createdAt));
    return this.views(
      tx,
      rows.map((r) => ({ ...r.p, serviceName: r.serviceName })),
    );
  }

  list(ctx: TenantContext, patientId: string) {
    return this.run(ctx, (tx) => this.load(tx, and(eq(sessionPackages.patientId, patientId))));
  }

  /** Pacotes ativos acabando (para a recepção oferecer a renovação). */
  endingSoon(ctx: TenantContext) {
    return this.run(ctx, async (tx) =>
      (await this.load(tx, and(eq(sessionPackages.status, 'active')))).filter((p) => p.endingSoon),
    );
  }

  create(ctx: TenantContext, patientId: string, input: PackageInput) {
    return this.run(ctx, async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p) throw new NotFoundException('Paciente não encontrado');
      const [s] = await tx.select().from(services).where(eq(services.id, input.serviceId));
      if (!s) throw new NotFoundException('Serviço não encontrado');
      const title = input.title?.trim() || `${input.totalSessions} sessões de ${s.name}`;
      const [pkg] = await tx
        .insert(sessionPackages)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          serviceId: s.id,
          title: title.slice(0, 120),
          totalSessions: input.totalSessions,
          priceCents: input.priceCents,
          noShowCounts: input.noShowCounts,
          validUntil: input.validUntil ?? null,
          notes: input.notes,
          createdBy: ctx.user.userId,
        })
        .returning();
      if (input.charge && input.priceCents > 0) {
        const n = input.charge.installments;
        const hoje = localClock(new Date(), await clinicTimezone(tx)).ymd;
        const datas = monthlyDueDates(input.charge.firstDueDate ?? hoje, n);
        await tx.insert(charges).values(
          splitInstallments(input.priceCents, n).map((amountCents, i) => ({
            tenantId: ctx.tenantId,
            patientId,
            packageId: pkg!.id,
            description: (n === 1 ? `Pacote: ${title}` : `Pacote: ${title} (${i + 1}/${n})`).slice(
              0,
              160,
            ),
            amountCents,
            dueDate: datas[i]!,
            installment: i + 1,
            installments: n,
            createdBy: ctx.user.userId,
          })),
        );
      }
      return (await this.load(tx, and(eq(sessionPackages.id, pkg!.id))))[0]!;
    });
  }

  /** Cancela o pacote. Sessões marcadas continuam na agenda; o financeiro fica como está. */
  cancel(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .update(sessionPackages)
        .set({ status: 'cancelled' })
        .where(eq(sessionPackages.id, id))
        .returning();
      if (!rows.length) throw new NotFoundException('Pacote não encontrado');
      return (await this.load(tx, and(eq(sessionPackages.id, id))))[0]!;
    });
  }
}
