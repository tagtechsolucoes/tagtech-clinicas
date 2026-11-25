import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { pgError, schema, type TenantTx } from '@tagtech/db';
import type { DisplayFont, RecordKind } from '@tagtech/domain';
import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { recordAudit } from '../audit/audit';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { MediaService } from '../media/media.service';

const {
  tenants,
  units,
  rooms,
  professionals,
  services,
  serviceProfessionals,
  workingHours,
  timeOff,
} = schema;

type Tenant = typeof tenants.$inferSelect;

export function clinicView(t: Tenant) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    tagline: t.tagline,
    about: t.about,
    whatsapp: t.whatsapp,
    instagram: t.instagram,
    logoUrl: t.logoUrl,
    coverUrl: t.coverUrl,
    theme: { primaryColor: t.brandPrimary, accentColor: t.brandAccent, displayFont: t.displayFont },
    booking: {
      enabled: t.bookingEnabled,
      minNoticeMinutes: t.bookingMinNoticeMinutes,
      horizonDays: t.bookingHorizonDays,
      slotStepMinutes: t.slotStepMinutes,
    },
  };
}

/** Dados para recibo e nota: só no painel, nunca no site público. */
export const legalView = (t: Tenant) => ({
  legalName: t.legalName,
  document: t.document,
  insuranceEnabled: t.insuranceEnabled,
});

export interface ClinicPatch {
  legalName?: string | undefined;
  document?: string | undefined;
  insuranceEnabled?: boolean | undefined;
  name?: string | undefined;
  tagline?: string | undefined;
  about?: string | undefined;
  whatsapp?: string | undefined;
  instagram?: string | undefined;
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
  displayFont?: DisplayFont | undefined;
  bookingEnabled?: boolean | undefined;
  minNoticeMinutes?: number | undefined;
  horizonDays?: number | undefined;
  slotStepMinutes?: number | undefined;
}

export interface UnitInput {
  name: string;
  timezone?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
  active?: boolean | undefined;
}

export interface ProfessionalInput {
  name: string;
  specialty?: string | undefined;
  council?: string | undefined;
  bio?: string | undefined;
  color?: string | undefined;
  onlineBooking?: boolean | undefined;
  active?: boolean | undefined;
  membershipId?: string | null | undefined;
  recordKind?: RecordKind | undefined;
}

export interface HoursInput {
  unitId: string;
  weekday: number;
  start: number;
  end: number;
}

export interface ServiceInput {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  durationMinutes: number;
  priceCents?: number | null | undefined;
  returnDays?: number | null | undefined;
  color?: string | undefined;
  onlineBooking?: boolean | undefined;
  active?: boolean | undefined;
  professionalIds?: string[] | undefined;
}

type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Só as chaves presentes: undefined não apaga nada no banco. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Cadastro da clínica: identidade, unidades, salas, profissionais, serviços e bloqueios. */
@Injectable()
export class ClinicService {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ clínica

  get(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const [tenant] = await tx.select().from(tenants);
      if (!tenant) throw new NotFoundException();
      const unitRows = await tx.select().from(units).orderBy(asc(units.createdAt));
      return { ...clinicView(tenant), ...legalView(tenant), units: unitRows.map(unitView) };
    });
  }

  update(ctx: TenantContext, patch: ClinicPatch) {
    return this.run(ctx, async (tx) => {
      const [tenant] = await tx
        .update(tenants)
        .set(
          defined({
            name: patch.name,
            tagline: patch.tagline,
            about: patch.about,
            whatsapp: patch.whatsapp,
            instagram: patch.instagram,
            brandPrimary: patch.primaryColor,
            brandAccent: patch.accentColor,
            displayFont: patch.displayFont,
            bookingEnabled: patch.bookingEnabled,
            bookingMinNoticeMinutes: patch.minNoticeMinutes,
            bookingHorizonDays: patch.horizonDays,
            slotStepMinutes: patch.slotStepMinutes,
            legalName: patch.legalName,
            document: patch.document,
            insuranceEnabled: patch.insuranceEnabled,
          }),
        )
        .where(eq(tenants.id, ctx.tenantId))
        .returning();
      if (!tenant) throw new NotFoundException();
      return { ...clinicView(tenant), ...legalView(tenant) };
    });
  }

  /** Troca (ou remove, com image = null) o logo ou a capa. A imagem antiga é apagada. */
  async setBrandImage(ctx: TenantContext, kind: 'logo' | 'cover', image: unknown | null) {
    const column = kind === 'logo' ? 'logoUrl' : 'coverUrl';
    const url = image === null ? null : await this.media.saveImage(image, kind);
    try {
      const { view, previous } = await this.run(ctx, async (tx) => {
        const [before] = await tx.select().from(tenants).for('update');
        if (!before) throw new NotFoundException();
        const [after] = await tx
          .update(tenants)
          .set({ [column]: url })
          .where(eq(tenants.id, ctx.tenantId))
          .returning();
        return { view: clinicView(after!), previous: before[column] };
      });
      await this.media.remove(previous);
      return view;
    } catch (error) {
      await this.media.remove(url);
      throw error;
    }
  }

  // ------------------------------------------------------------ unidades e salas

  createUnit(ctx: TenantContext, input: UnitInput) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ tenantId: ctx.tenantId, ...defined({ ...input }), name: input.name })
        .returning();
      return unitView(row!);
    });
  }

  updateUnit(ctx: TenantContext, id: string, input: Patch<UnitInput>) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(units)
        .set(defined({ ...input }))
        .where(eq(units.id, id))
        .returning();
      if (!row) throw new NotFoundException('Unidade não encontrada');
      return unitView(row);
    });
  }

  listRooms(ctx: TenantContext) {
    return this.run(ctx, (tx) =>
      tx
        .select()
        .from(rooms)
        .orderBy(asc(rooms.name))
        .then((r) => r.map(roomView)),
    );
  }

  createRoom(ctx: TenantContext, input: { unitId: string; name: string }) {
    return this.run(ctx, async (tx) => {
      await this.assertUnit(tx, input.unitId);
      const [row] = await tx
        .insert(rooms)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning();
      return roomView(row!);
    });
  }

  updateRoom(
    ctx: TenantContext,
    id: string,
    input: { name?: string | undefined; active?: boolean | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx.update(rooms).set(defined(input)).where(eq(rooms.id, id)).returning();
      if (!row) throw new NotFoundException('Sala não encontrada');
      return roomView(row);
    });
  }

  private async assertUnit(tx: TenantTx, unitId: string) {
    const [u] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
    if (!u) throw new NotFoundException('Unidade não encontrada');
  }

  // ------------------------------------------------------------ profissionais

  listProfessionals(ctx: TenantContext) {
    return this.run(ctx, (tx) => loadProfessionals(tx));
  }

  createProfessional(ctx: TenantContext, input: ProfessionalInput) {
    return this.run(ctx, async (tx) => {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: professionals.position })
        .from(professionals)
        .orderBy(asc(professionals.position))
        .limit(1);
      const [row] = await tx
        .insert(professionals)
        .values({
          tenantId: ctx.tenantId,
          position: n - 1,
          ...defined({ ...input }),
          name: input.name,
        })
        .returning()
        .catch((e) => this.mapUnique(e));
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'professional.created',
        summary: `Profissional cadastrado: ${input.name}`,
      });
      return (await loadProfessionals(tx, [row!.id]))[0]!;
    });
  }

  updateProfessional(ctx: TenantContext, id: string, input: Patch<ProfessionalInput>) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(professionals)
        .set(defined({ ...input }))
        .where(eq(professionals.id, id))
        .returning()
        .catch((e) => this.mapUnique(e));
      if (!row) throw new NotFoundException('Profissional não encontrado');
      return (await loadProfessionals(tx, [id]))[0]!;
    });
  }

  /** Substitui a semana de trabalho do profissional. */
  setHours(ctx: TenantContext, professionalId: string, hours: HoursInput[]) {
    return this.run(ctx, async (tx) => {
      const [pro] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .where(eq(professionals.id, professionalId));
      if (!pro) throw new NotFoundException('Profissional não encontrado');
      // Turnos do mesmo dia não podem se sobrepor.
      for (const a of hours) {
        for (const b of hours) {
          if (a !== b && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
            throw new ConflictException('Dois turnos do mesmo dia se sobrepõem');
          }
        }
      }
      const unitIds = [...new Set(hours.map((h) => h.unitId))];
      if (unitIds.length) {
        const found = await tx
          .select({ id: units.id })
          .from(units)
          .where(inArray(units.id, unitIds));
        if (found.length !== unitIds.length) throw new NotFoundException('Unidade não encontrada');
      }
      await tx.delete(workingHours).where(eq(workingHours.professionalId, professionalId));
      if (hours.length) {
        await tx.insert(workingHours).values(
          hours.map((h) => ({
            tenantId: ctx.tenantId,
            professionalId,
            unitId: h.unitId,
            weekday: h.weekday,
            startMinute: h.start,
            endMinute: h.end,
          })),
        );
      }
      return (await loadProfessionals(tx, [professionalId]))[0]!;
    });
  }

  async setProfessionalPhoto(ctx: TenantContext, id: string, image: unknown | null) {
    const url = image === null ? null : await this.media.saveImage(image, 'photo');
    try {
      const { view, previous } = await this.run(ctx, async (tx) => {
        const [before] = await tx
          .select()
          .from(professionals)
          .where(eq(professionals.id, id))
          .for('update');
        if (!before) throw new NotFoundException('Profissional não encontrado');
        await tx.update(professionals).set({ photoUrl: url }).where(eq(professionals.id, id));
        return { view: (await loadProfessionals(tx, [id]))[0]!, previous: before.photoUrl };
      });
      await this.media.remove(previous);
      return view;
    } catch (error) {
      await this.media.remove(url);
      throw error;
    }
  }

  // ------------------------------------------------------------ serviços

  listServices(ctx: TenantContext) {
    return this.run(ctx, (tx) => loadServices(tx));
  }

  createService(ctx: TenantContext, input: ServiceInput) {
    return this.run(ctx, async (tx) => {
      const { professionalIds, ...data } = input;
      const [row] = await tx
        .insert(services)
        .values({
          tenantId: ctx.tenantId,
          ...defined({ ...data }),
          name: data.name,
          durationMinutes: data.durationMinutes,
        })
        .returning();
      if (professionalIds) await this.linkProfessionals(tx, ctx, row!.id, professionalIds);
      return (await loadServices(tx, [row!.id]))[0]!;
    });
  }

  updateService(ctx: TenantContext, id: string, input: Patch<ServiceInput>) {
    return this.run(ctx, async (tx) => {
      const { professionalIds, ...data } = input;
      const patch = defined({ ...data });
      const [row] = Object.keys(patch).length
        ? await tx.update(services).set(patch).where(eq(services.id, id)).returning()
        : await tx.select().from(services).where(eq(services.id, id));
      if (!row) throw new NotFoundException('Serviço não encontrado');
      if (professionalIds) await this.linkProfessionals(tx, ctx, id, professionalIds);
      if (data.priceCents !== undefined) {
        await recordAudit(tx, ctx, {
          unitId: null,
          action: 'service.price_changed',
          summary: `Preço de ${row.name} alterado`,
          details: { serviceId: id, priceCents: data.priceCents },
        });
      }
      return (await loadServices(tx, [id]))[0]!;
    });
  }

  private async linkProfessionals(
    tx: TenantTx,
    ctx: TenantContext,
    serviceId: string,
    ids: string[],
  ) {
    const unique = [...new Set(ids)];
    if (unique.length) {
      const found = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .where(inArray(professionals.id, unique));
      if (found.length !== unique.length)
        throw new NotFoundException('Profissional não encontrado');
    }
    await tx.delete(serviceProfessionals).where(eq(serviceProfessionals.serviceId, serviceId));
    if (unique.length) {
      await tx
        .insert(serviceProfessionals)
        .values(
          unique.map((professionalId) => ({ tenantId: ctx.tenantId, serviceId, professionalId })),
        );
    }
  }

  // ------------------------------------------------------------ bloqueios

  listTimeOff(ctx: TenantContext, from: Date, to: Date) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(timeOff)
        .where(and(lt(timeOff.startsAt, to), gt(timeOff.endsAt, from)))
        .orderBy(asc(timeOff.startsAt));
      return rows.map(timeOffView);
    });
  }

  createTimeOff(
    ctx: TenantContext,
    input: {
      professionalId: string | null;
      unitId: string | null;
      startsAt: Date;
      endsAt: Date;
      reason: string;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .insert(timeOff)
        .values({ tenantId: ctx.tenantId, ...input, createdBy: ctx.user.userId })
        .returning()
        .catch((e) => {
          if (pgError(e).code === '23503')
            throw new NotFoundException('Profissional ou unidade não encontrado');
          throw e;
        });
      return timeOffView(row!);
    });
  }

  deleteTimeOff(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.delete(timeOff).where(eq(timeOff.id, id)).returning();
      if (!rows.length) throw new NotFoundException('Bloqueio não encontrado');
    });
  }

  private mapUnique(e: unknown): never {
    const { code, constraint } = pgError(e);
    if (code === '23505' && constraint === 'professionals_membership_id_key') {
      throw new ConflictException('Esta conta já está ligada a outro profissional');
    }
    if (code === '23503') throw new NotFoundException('Conta da equipe não encontrada');
    throw e;
  }
}

// ---------------------------------------------------------------- views

export function unitView(u: typeof units.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    timezone: u.timezone,
    address: u.address,
    phone: u.phone,
    active: u.active,
  };
}

export function roomView(r: typeof rooms.$inferSelect) {
  return { id: r.id, unitId: r.unitId, name: r.name, active: r.active };
}

export function timeOffView(t: typeof timeOff.$inferSelect) {
  return {
    id: t.id,
    professionalId: t.professionalId,
    unitId: t.unitId,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    reason: t.reason,
  };
}

/** Profissionais com a semana de trabalho e os serviços que fazem. */
export async function loadProfessionals(tx: TenantTx, ids?: string[]) {
  const rows = await tx
    .select()
    .from(professionals)
    .where(ids ? inArray(professionals.id, ids) : undefined)
    .orderBy(asc(professionals.position), asc(professionals.name));
  if (!rows.length) return [];
  const pids = rows.map((r) => r.id);
  const hours = await tx
    .select()
    .from(workingHours)
    .where(inArray(workingHours.professionalId, pids))
    .orderBy(asc(workingHours.weekday), asc(workingHours.startMinute));
  const links = await tx
    .select()
    .from(serviceProfessionals)
    .where(inArray(serviceProfessionals.professionalId, pids));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    specialty: p.specialty,
    council: p.council,
    bio: p.bio,
    photoUrl: p.photoUrl,
    color: p.color,
    onlineBooking: p.onlineBooking,
    active: p.active,
    membershipId: p.membershipId,
    recordKind: p.recordKind,
    hours: hours
      .filter((h) => h.professionalId === p.id)
      .map((h) => ({
        unitId: h.unitId,
        weekday: h.weekday,
        start: h.startMinute,
        end: h.endMinute,
      })),
    serviceIds: links.filter((l) => l.professionalId === p.id).map((l) => l.serviceId),
  }));
}

export async function loadServices(tx: TenantTx, ids?: string[]) {
  const rows = await tx
    .select()
    .from(services)
    .where(ids ? inArray(services.id, ids) : undefined)
    .orderBy(asc(services.position), asc(services.name));
  if (!rows.length) return [];
  const links = await tx
    .select()
    .from(serviceProfessionals)
    .where(
      inArray(
        serviceProfessionals.serviceId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    durationMinutes: s.durationMinutes,
    priceCents: s.priceCents,
    returnDays: s.returnDays,
    color: s.color,
    onlineBooking: s.onlineBooking,
    active: s.active,
    professionalIds: links.filter((l) => l.serviceId === s.id).map((l) => l.professionalId),
  }));
}
