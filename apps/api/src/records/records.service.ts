import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { memberNames, pgError, schema, type TenantTx } from '@tagtech/db';
import {
  cleanRecordData,
  IMAGE_CONSENT_TERM,
  RECORD_TEMPLATES,
  type RecordKind,
  type ToothState,
} from '@tagtech/domain';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { MediaService, type HideArea } from '../media/media.service';

const {
  clinicalNotes,
  galleryItems,
  imageConsents,
  memberships,
  patientAccessLog,
  patientPhotos,
  patients,
  professionals,
  toothChart,
} = schema;

type Note = typeof clinicalNotes.$inferSelect;
type Photo = typeof patientPhotos.$inferSelect;

export interface NoteInput {
  kind: RecordKind;
  data: Record<string, unknown>;
  text: string;
  appointmentId?: string | undefined;
  private?: boolean | undefined;
  addendumOf?: string | undefined;
}

export interface PhotoMeta {
  stage: 'before' | 'during' | 'after';
  region: string;
  angle: string;
  takenOn?: string | undefined;
  note: string;
  appointmentId?: string | undefined;
}

/**
 * Prontuário: evoluções, odontograma, fotos clínicas e autorização de imagem.
 * Evolução sigilosa só aparece para quem escreveu; finalizada não muda mais.
 */
@Injectable()
export class RecordsService {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  private async assertPatient(tx: TenantTx, patientId: string) {
    const [p] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(eq(patients.id, patientId));
    if (!p) throw new NotFoundException('Paciente não encontrado');
  }

  private log(tx: TenantTx, ctx: TenantContext, patientId: string, action: 'view' | 'update') {
    return tx
      .insert(patientAccessLog)
      .values({ tenantId: ctx.tenantId, patientId, actorUserId: ctx.user.userId, action });
  }

  // ------------------------------------------------------------ evoluções

  private noteView(
    n: Note,
    ctx: TenantContext,
    names: Map<string, string>,
    pros: Map<string, string>,
  ) {
    const mine = n.authorUserId === ctx.user.userId;
    const hidden = n.private && !mine;
    return {
      id: n.id,
      kind: n.kind,
      appointmentId: n.appointmentId,
      professionalName: n.professionalId ? (pros.get(n.professionalId) ?? null) : null,
      author: n.authorUserId ? (names.get(n.authorUserId) ?? 'Pessoa removida') : 'Equipe',
      mine,
      private: n.private,
      // Sigilosa de outra pessoa: aparece que existe, sem o conteúdo.
      hidden,
      data: hidden ? {} : n.data,
      text: hidden ? '' : n.text,
      locked: n.lockedAt !== null,
      addendumOf: n.addendumOf,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    };
  }

  private async views(tx: TenantTx, ctx: TenantContext, rows: Note[]) {
    const names = await memberNames(tx, [
      ...new Set(rows.flatMap((r) => (r.authorUserId ? [r.authorUserId] : []))),
    ]);
    const pros = new Map(
      (await tx.select({ id: professionals.id, name: professionals.name }).from(professionals)).map(
        (p) => [p.id, p.name],
      ),
    );
    return rows.map((r) => this.noteView(r, ctx, names, pros));
  }

  notes(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      await this.log(tx, ctx, patientId, 'view');
      const rows = await tx
        .select()
        .from(clinicalNotes)
        .where(eq(clinicalNotes.patientId, patientId))
        .orderBy(desc(clinicalNotes.createdAt));
      return this.views(tx, ctx, rows);
    });
  }

  createNote(ctx: TenantContext, patientId: string, input: NoteInput) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      const clean = cleanRecordData(input.kind, input.data);
      if (!clean.ok) throw new BadRequestException(clean.error);
      if (!Object.keys(clean.data).length && !input.text.trim()) {
        throw new BadRequestException('Escreva alguma coisa na evolução');
      }
      // O profissional da evolução é o da conta de quem escreve, quando houver.
      const [pro] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .innerJoin(memberships, eq(memberships.id, professionals.membershipId))
        .where(eq(memberships.userId, ctx.user.userId));
      if (input.addendumOf) {
        const [base] = await tx
          .select()
          .from(clinicalNotes)
          .where(eq(clinicalNotes.id, input.addendumOf));
        if (!base || base.patientId !== patientId)
          throw new NotFoundException('Evolução não encontrada');
      }
      const [row] = await tx
        .insert(clinicalNotes)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          appointmentId: input.appointmentId ?? null,
          professionalId: pro?.id ?? null,
          kind: input.kind,
          data: clean.data,
          text: input.text.trim(),
          private: input.private ?? RECORD_TEMPLATES[input.kind].privateByDefault,
          authorUserId: ctx.user.userId,
          addendumOf: input.addendumOf ?? null,
        })
        .returning()
        .catch((e) => {
          if (pgError(e).code === '23503') throw new NotFoundException('Consulta não encontrada');
          throw e;
        });
      await this.log(tx, ctx, patientId, 'update');
      return (await this.views(tx, ctx, [row!]))[0]!;
    });
  }

  private async ownNote(tx: TenantTx, ctx: TenantContext, id: string) {
    const [n] = await tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)).for('update');
    if (!n || (n.private && n.authorUserId !== ctx.user.userId))
      throw new NotFoundException('Evolução não encontrada');
    if (n.authorUserId !== ctx.user.userId)
      throw new ForbiddenException('Só quem escreveu altera a evolução');
    if (n.lockedAt) throw new ConflictException('Evolução finalizada não muda. Escreva um adendo.');
    return n;
  }

  updateNote(
    ctx: TenantContext,
    id: string,
    input: {
      data?: Record<string, unknown> | undefined;
      text?: string | undefined;
      private?: boolean | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const n = await this.ownNote(tx, ctx, id);
      let data = n.data;
      if (input.data) {
        const clean = cleanRecordData(n.kind, input.data);
        if (!clean.ok) throw new BadRequestException(clean.error);
        data = clean.data;
      }
      const [row] = await tx
        .update(clinicalNotes)
        .set({
          data,
          ...(input.text !== undefined ? { text: input.text.trim() } : {}),
          ...(input.private !== undefined ? { private: input.private } : {}),
          updatedAt: new Date(),
        })
        .where(eq(clinicalNotes.id, id))
        .returning();
      await this.log(tx, ctx, n.patientId, 'update');
      return (await this.views(tx, ctx, [row!]))[0]!;
    });
  }

  lockNote(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      await this.ownNote(tx, ctx, id);
      const [row] = await tx
        .update(clinicalNotes)
        .set({ lockedAt: new Date() })
        .where(eq(clinicalNotes.id, id))
        .returning();
      return (await this.views(tx, ctx, [row!]))[0]!;
    });
  }

  // ------------------------------------------------------------ odontograma

  teeth(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      const rows = await tx
        .select()
        .from(toothChart)
        .where(eq(toothChart.patientId, patientId))
        .orderBy(asc(toothChart.tooth));
      return rows.map((r) => ({
        tooth: r.tooth,
        state: r.state,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
  }

  setTooth(
    ctx: TenantContext,
    patientId: string,
    tooth: number,
    state: ToothState | null,
    note: string,
  ) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      if (state === null) {
        await tx
          .delete(toothChart)
          .where(and(eq(toothChart.patientId, patientId), eq(toothChart.tooth, tooth)));
      } else {
        const values = { state, note, updatedBy: ctx.user.userId, updatedAt: new Date() };
        await tx
          .insert(toothChart)
          .values({ tenantId: ctx.tenantId, patientId, tooth, ...values })
          .onConflictDoUpdate({ target: [toothChart.patientId, toothChart.tooth], set: values });
      }
      await this.log(tx, ctx, patientId, 'update');
      return { tooth, state, note };
    });
  }

  // ------------------------------------------------------------ fotos

  private photoView(p: Photo) {
    return {
      id: p.id,
      stage: p.stage,
      region: p.region,
      angle: p.angle,
      takenOn: p.takenOn,
      note: p.note,
      appointmentId: p.appointmentId,
      createdAt: p.createdAt.toISOString(),
    };
  }

  photos(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      const rows = await tx
        .select()
        .from(patientPhotos)
        .where(eq(patientPhotos.patientId, patientId))
        .orderBy(asc(patientPhotos.takenOn), asc(patientPhotos.createdAt));
      return rows.map((p) => this.photoView(p));
    });
  }

  async addPhoto(ctx: TenantContext, patientId: string, image: unknown, meta: PhotoMeta) {
    const file = await this.media.saveClinical(image);
    try {
      return await this.run(ctx, async (tx) => {
        await this.assertPatient(tx, patientId);
        const [row] = await tx
          .insert(patientPhotos)
          .values({
            tenantId: ctx.tenantId,
            patientId,
            file,
            stage: meta.stage,
            region: meta.region,
            angle: meta.angle,
            note: meta.note,
            appointmentId: meta.appointmentId ?? null,
            createdBy: ctx.user.userId,
            ...(meta.takenOn ? { takenOn: meta.takenOn } : {}),
          })
          .returning()
          .catch((e) => {
            if (pgError(e).code === '23503') throw new NotFoundException('Consulta não encontrada');
            throw e;
          });
        await this.log(tx, ctx, patientId, 'update');
        return this.photoView(row!);
      });
    } catch (e) {
      await this.media.removeClinical(file);
      throw e;
    }
  }

  updatePhoto(
    ctx: TenantContext,
    id: string,
    patch: { [K in keyof PhotoMeta]?: PhotoMeta[K] | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      const { appointmentId: _a, ...rest } = patch;
      const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const [row] = Object.keys(set).length
        ? await tx.update(patientPhotos).set(set).where(eq(patientPhotos.id, id)).returning()
        : await tx.select().from(patientPhotos).where(eq(patientPhotos.id, id));
      if (!row) throw new NotFoundException('Foto não encontrada');
      return this.photoView(row);
    });
  }

  async deletePhoto(ctx: TenantContext, id: string) {
    const { file, publicUrls } = await this.run(ctx, async (tx) => {
      const [row] = await tx.select().from(patientPhotos).where(eq(patientPhotos.id, id));
      if (!row) throw new NotFoundException('Foto não encontrada');
      const items = await tx.select().from(galleryItems);
      const used = items.filter((g) => g.beforePhoto === id || g.afterPhoto === id);
      await tx.delete(patientPhotos).where(eq(patientPhotos.id, id));
      await this.log(tx, ctx, row.patientId, 'update');
      return { file: row.file, publicUrls: used.flatMap((g) => [g.beforeUrl, g.afterUrl]) };
    });
    await this.media.removeClinical(file);
    for (const u of publicUrls) await this.media.remove(u);
  }

  /** O arquivo da foto, só para quem está logado na clínica. */
  photoFile(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx.select().from(patientPhotos).where(eq(patientPhotos.id, id));
      if (!row) throw new NotFoundException('Foto não encontrada');
      return this.media.openClinical(row.file);
    });
  }

  // ------------------------------------------------------------ autorização de imagem

  private consentView(c: typeof imageConsents.$inferSelect | undefined) {
    return c
      ? {
          active: true,
          id: c.id,
          scope: c.scope,
          signedOn: c.signedOn,
          termText: c.termText,
          createdAt: c.createdAt.toISOString(),
        }
      : { active: false, termText: IMAGE_CONSENT_TERM };
  }

  consent(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      const [c] = await tx
        .select()
        .from(imageConsents)
        .where(and(eq(imageConsents.patientId, patientId), isNull(imageConsents.revokedAt)));
      return this.consentView(c);
    });
  }

  recordConsent(
    ctx: TenantContext,
    patientId: string,
    input: { scope: 'site' | 'social' | 'both'; signedOn: string; termText?: string | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      await this.assertPatient(tx, patientId);
      const [c] = await tx
        .insert(imageConsents)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          scope: input.scope,
          signedOn: input.signedOn,
          termText: input.termText?.trim() || IMAGE_CONSENT_TERM,
          recordedBy: ctx.user.userId,
        })
        .returning()
        .catch((e) => {
          if (pgError(e).code === '23505')
            throw new ConflictException('Este paciente já tem uma autorização ativa');
          throw e;
        });
      return this.consentView(c);
    });
  }

  /** Revoga a autorização e tira da galeria pública tudo que era do paciente. */
  async revokeConsent(ctx: TenantContext, patientId: string) {
    const urls = await this.run(ctx, async (tx) => {
      await tx
        .update(imageConsents)
        .set({ revokedAt: new Date() })
        .where(and(eq(imageConsents.patientId, patientId), isNull(imageConsents.revokedAt)));
      const removed = await tx
        .delete(galleryItems)
        .where(eq(galleryItems.patientId, patientId))
        .returning();
      return removed.flatMap((g) => [g.beforeUrl, g.afterUrl]);
    });
    for (const u of urls) await this.media.remove(u);
    return this.consentView(undefined);
  }

  // ------------------------------------------------------------ galeria do site

  gallery(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({ g: galleryItems, patientName: patients.name })
        .from(galleryItems)
        .innerJoin(patients, eq(patients.id, galleryItems.patientId))
        .orderBy(asc(galleryItems.position), desc(galleryItems.createdAt));
      return rows.map(({ g, patientName }) => ({
        id: g.id,
        title: g.title,
        serviceId: g.serviceId,
        beforeUrl: g.beforeUrl,
        afterUrl: g.afterUrl,
        patientId: g.patientId,
        patientName,
      }));
    });
  }

  /** Publica um par antes/depois. Exige autorização ativa para o site. */
  async publish(
    ctx: TenantContext,
    input: {
      beforePhotoId: string;
      afterPhotoId: string;
      title: string;
      serviceId?: string | undefined;
      hideBefore?: HideArea[] | undefined;
      hideAfter?: HideArea[] | undefined;
    },
  ) {
    const { before, after } = await this.run(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(patientPhotos)
        .where(eq(patientPhotos.id, input.beforePhotoId));
      const [after] = await tx
        .select()
        .from(patientPhotos)
        .where(eq(patientPhotos.id, input.afterPhotoId));
      if (!before || !after) throw new NotFoundException('Foto não encontrada');
      if (before.patientId !== after.patientId)
        throw new BadRequestException('As duas fotos precisam ser do mesmo paciente');
      const [c] = await tx
        .select()
        .from(imageConsents)
        .where(and(eq(imageConsents.patientId, before.patientId), isNull(imageConsents.revokedAt)));
      if (!c || c.scope === 'social') {
        throw new ConflictException(
          'Sem autorização de imagem para o site. Registre a autorização assinada pelo paciente.',
        );
      }
      return { before, after };
    });
    const beforeUrl = await this.media.publishClinical(before.file, input.hideBefore ?? []);
    const afterUrl = await this.media.publishClinical(after.file, input.hideAfter ?? []);
    try {
      return await this.run(ctx, async (tx) => {
        const [g] = await tx
          .insert(galleryItems)
          .values({
            tenantId: ctx.tenantId,
            patientId: before.patientId,
            beforePhoto: before.id,
            afterPhoto: after.id,
            beforeUrl,
            afterUrl,
            title: input.title,
            serviceId: input.serviceId ?? null,
          })
          .returning();
        return { id: g!.id, title: g!.title, beforeUrl, afterUrl };
      });
    } catch (e) {
      await this.media.remove(beforeUrl);
      await this.media.remove(afterUrl);
      throw e;
    }
  }

  async unpublish(ctx: TenantContext, id: string) {
    const removed = await this.run(ctx, async (tx) => {
      const [g] = await tx.delete(galleryItems).where(eq(galleryItems.id, id)).returning();
      if (!g) throw new NotFoundException('Item da galeria não encontrado');
      return g;
    });
    await this.media.remove(removed.beforeUrl);
    await this.media.remove(removed.afterUrl);
  }
}
