import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';

const {
  appointments,
  clinicalDocuments,
  memberships,
  patientAccessLog,
  patients,
  professionals,
  tenants,
  units,
} = schema;

export type DocumentKind = 'prescription' | 'certificate' | 'declaration' | 'exam_request';

export interface DocumentInput {
  kind: DocumentKind;
  professionalId?: string | undefined;
  appointmentId?: string | undefined;
  content: Record<string, unknown>;
}

/**
 * Receita, atestado, declaração de comparecimento e pedido de exame. Ficam no prontuário
 * e não mudam depois de emitidos; o PDF sai do painel com a identidade da clínica.
 */
@Injectable()
export class DocumentsService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  private async view(tx: TenantTx, where: ReturnType<typeof and>) {
    const rows = await tx
      .select({ d: clinicalDocuments, pro: professionals })
      .from(clinicalDocuments)
      .innerJoin(professionals, eq(professionals.id, clinicalDocuments.professionalId))
      .where(where)
      .orderBy(desc(clinicalDocuments.createdAt));
    return rows.map(({ d, pro }) => ({
      id: d.id,
      kind: d.kind,
      patientId: d.patientId,
      appointmentId: d.appointmentId,
      professional: { id: pro.id, name: pro.name, council: pro.council, specialty: pro.specialty },
      content: d.content,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  list(ctx: TenantContext, patientId: string) {
    return this.run(ctx, (tx) => this.view(tx, and(eq(clinicalDocuments.patientId, patientId))));
  }

  /** Documento pronto para imprimir: com clínica e paciente. Abrir fica no registro de acesso. */
  get(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [doc] = await this.view(tx, and(eq(clinicalDocuments.id, id)));
      if (!doc) throw new NotFoundException('Documento não encontrado');
      const [p] = await tx.select().from(patients).where(eq(patients.id, doc.patientId));
      const [t] = await tx.select().from(tenants);
      const [u] = await tx.select().from(units).orderBy(asc(units.createdAt)).limit(1);
      await tx.insert(patientAccessLog).values({
        tenantId: ctx.tenantId,
        patientId: doc.patientId,
        actorUserId: ctx.user.userId,
        action: 'view',
      });
      return {
        ...doc,
        patient: { name: p!.name, cpf: p!.cpf, birthDate: p!.birthDate },
        clinic: {
          name: t!.name,
          legalName: t!.legalName,
          document: t!.document,
          logoUrl: t!.logoUrl,
          primaryColor: t!.brandPrimary,
          address: u?.address ?? '',
          phone: u?.phone ?? '',
          city: u?.address.split('·').pop()?.trim() ?? '',
          timezone: u?.timezone ?? 'America/Recife',
        },
      };
    });
  }

  create(ctx: TenantContext, patientId: string, input: DocumentInput) {
    return this.run(ctx, async (tx) => {
      const [p] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.id, patientId));
      if (!p) throw new NotFoundException('Paciente não encontrado');
      // Quem é profissional assina pelo próprio cadastro; dono e gerente escolhem.
      const [meu] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .innerJoin(memberships, eq(memberships.id, professionals.membershipId))
        .where(eq(memberships.userId, ctx.user.userId));
      const professionalId =
        ctx.membership.role === 'professional' ? meu?.id : (input.professionalId ?? meu?.id);
      if (!professionalId)
        throw new BadRequestException('Escolha o profissional que assina o documento');
      const [pro] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .where(eq(professionals.id, professionalId));
      if (!pro) throw new NotFoundException('Profissional não encontrado');
      if (input.appointmentId) {
        const [a] = await tx
          .select({ patientId: appointments.patientId })
          .from(appointments)
          .where(eq(appointments.id, input.appointmentId));
        if (!a || a.patientId !== patientId)
          throw new BadRequestException('A consulta é de outro paciente');
      }
      const [row] = await tx
        .insert(clinicalDocuments)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          professionalId,
          appointmentId: input.appointmentId ?? null,
          authorUserId: ctx.user.userId,
          kind: input.kind,
          content: input.content,
        })
        .returning();
      await tx.insert(patientAccessLog).values({
        tenantId: ctx.tenantId,
        patientId,
        actorUserId: ctx.user.userId,
        action: 'create',
      });
      return (await this.view(tx, and(eq(clinicalDocuments.id, row!.id))))[0]!;
    });
  }
}
