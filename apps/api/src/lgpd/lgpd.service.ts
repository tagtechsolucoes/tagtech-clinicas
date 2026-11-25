import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { MediaService } from '../media/media.service';

const s = schema;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * Direitos do titular (LGPD, art. 18) e saída de dados da clínica.
 *
 * Exclusão: o prontuário tem guarda obrigatória (Lei 13.787/2018: 20 anos), então quem tem
 * histórico clínico ou financeiro fica com o contato apagado e o prontuário guardado.
 * Quem não tem histórico é apagado de vez.
 */
@Injectable()
export class LgpdService {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  private log(tx: TenantTx, ctx: TenantContext, patientId: string, action: 'export' | 'erase') {
    return tx
      .insert(s.patientAccessLog)
      .values({ tenantId: ctx.tenantId, patientId, actorUserId: ctx.user.userId, action });
  }

  /** Tudo o que a clínica guarda sobre o paciente, num arquivo só. */
  exportPatient(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      const [p] = await tx.select().from(s.patients).where(eq(s.patients.id, patientId));
      if (!p) throw new NotFoundException('Paciente não encontrado');
      const [t] = await tx.select().from(s.tenants);
      const consultas = await tx
        .select({ a: s.appointments, servico: s.services.name, profissional: s.professionals.name })
        .from(s.appointments)
        .innerJoin(s.services, eq(s.services.id, s.appointments.serviceId))
        .innerJoin(s.professionals, eq(s.professionals.id, s.appointments.professionalId))
        .where(eq(s.appointments.patientId, patientId))
        .orderBy(asc(s.appointments.startsAt));
      const notas = await tx
        .select()
        .from(s.clinicalNotes)
        .where(eq(s.clinicalNotes.patientId, patientId))
        .orderBy(asc(s.clinicalNotes.createdAt));
      const dentes = await tx
        .select()
        .from(s.toothChart)
        .where(eq(s.toothChart.patientId, patientId));
      const fotos = await tx
        .select()
        .from(s.patientPhotos)
        .where(eq(s.patientPhotos.patientId, patientId));
      const imagem = await tx
        .select()
        .from(s.imageConsents)
        .where(eq(s.imageConsents.patientId, patientId));
      const orcamentos = await tx
        .select()
        .from(s.treatmentPlans)
        .where(eq(s.treatmentPlans.patientId, patientId));
      const itens = orcamentos.length
        ? await tx
            .select()
            .from(s.treatmentPlanItems)
            .where(
              inArray(
                s.treatmentPlanItems.planId,
                orcamentos.map((o) => o.id),
              ),
            )
        : [];
      const cobrancas = await tx.select().from(s.charges).where(eq(s.charges.patientId, patientId));
      const cartoes = await tx
        .select({ c: s.patientInsurances, plano: s.insurers.name })
        .from(s.patientInsurances)
        .innerJoin(s.insurers, eq(s.insurers.id, s.patientInsurances.insurerId))
        .where(eq(s.patientInsurances.patientId, patientId));
      const espera = await tx.select().from(s.waitlist).where(eq(s.waitlist.patientId, patientId));
      const mensagens = consultas.length
        ? await tx
            .select()
            .from(s.appointmentMessages)
            .where(
              inArray(
                s.appointmentMessages.appointmentId,
                consultas.map((c) => c.a.id),
              ),
            )
        : [];
      const acessos = await tx
        .select()
        .from(s.patientAccessLog)
        .where(eq(s.patientAccessLog.patientId, patientId))
        .orderBy(asc(s.patientAccessLog.createdAt));
      const documentos = await tx
        .select()
        .from(s.clinicalDocuments)
        .where(eq(s.clinicalDocuments.patientId, patientId))
        .orderBy(asc(s.clinicalDocuments.createdAt));
      const pacotes = await tx
        .select()
        .from(s.sessionPackages)
        .where(eq(s.sessionPackages.patientId, patientId));
      const outrasMensagens = await tx
        .select()
        .from(s.patientMessages)
        .where(eq(s.patientMessages.patientId, patientId));
      const avaliacoes = await tx
        .select()
        .from(s.reviewRequests)
        .where(eq(s.reviewRequests.patientId, patientId));
      await this.log(tx, ctx, patientId, 'export');

      return {
        geradoEm: new Date().toISOString(),
        controlador: { clinica: t!.name, razaoSocial: t!.legalName, documento: t!.document },
        aviso:
          'Cópia dos dados pessoais tratados pela clínica (LGPD, art. 18, II). As fotos clínicas são entregues à parte pela clínica.',
        paciente: {
          nome: p.name,
          whatsapp: p.phone,
          email: p.email,
          nascimento: p.birthDate,
          cpf: p.cpf,
          alergias: p.allergies,
          medicamentos: p.medications,
          observacoes: p.notes,
          origem: p.source,
          aceiteDoUsoDosDados: iso(p.consentAt),
          cadastradoEm: iso(p.createdAt),
          contatoApagadoEm: iso(p.contactErasedAt),
        },
        consultas: consultas.map((c) => ({
          inicio: iso(c.a.startsAt),
          fim: iso(c.a.endsAt),
          servico: c.servico,
          profissional: c.profissional,
          situacao: c.a.status,
          origem: c.a.source,
          valorCentavos: c.a.priceCents,
          observacoes: c.a.notes,
          motivoCancelamento: c.a.cancelReason,
        })),
        // Evolução sigilosa (ex.: psicologia) só sai com o conteúdo para quem escreveu.
        prontuario: notas.map((n) => ({
          tipo: n.kind,
          ...(n.private && n.authorUserId !== ctx.user.userId
            ? { campos: {}, texto: null, conteudo: 'Sigiloso: peça ao profissional que escreveu' }
            : { campos: n.data, texto: n.text }),
          sigiloso: n.private,
          finalizadoEm: iso(n.lockedAt),
          escritoEm: iso(n.createdAt),
        })),
        odontograma: dentes.map((d) => ({ dente: d.tooth, estado: d.state, observacao: d.note })),
        fotos: fotos.map((f) => ({
          etapa: f.stage,
          regiao: f.region,
          angulo: f.angle,
          data: f.takenOn,
          observacao: f.note,
        })),
        autorizacaoDeImagem: imagem.map((i) => ({
          alcance: i.scope,
          assinadaEm: i.signedOn,
          revogadaEm: iso(i.revokedAt),
          termo: i.termText,
        })),
        orcamentos: orcamentos.map((o) => ({
          titulo: o.title,
          situacao: o.status,
          criadoEm: iso(o.createdAt),
          itens: itens
            .filter((i) => i.planId === o.id)
            .map((i) => ({
              descricao: i.description,
              dente: i.tooth,
              quantidade: i.quantity,
              valorCentavos: i.unitPriceCents,
            })),
        })),
        financeiro: cobrancas.map((c) => ({
          descricao: c.description,
          valorCentavos: c.amountCents,
          vencimento: c.dueDate,
          situacao: c.status,
          forma: c.method,
          pagoEm: iso(c.paidAt),
        })),
        convenios: cartoes.map((c) => ({
          plano: c.plano,
          carteirinha: c.c.cardNumber,
          validade: c.c.validUntil,
        })),
        listaDeEspera: espera.map((w) => ({
          de: w.fromDate,
          ate: w.toDate,
          periodo: w.period,
          situacao: w.status,
        })),
        mensagensWhatsApp: mensagens.map((m) => ({
          tipo: m.event,
          situacao: m.status,
          enviadaEm: iso(m.createdAt),
        })),
        documentos: documentos.map((d) => ({
          tipo: d.kind,
          conteudo: d.content,
          emitidoEm: iso(d.createdAt),
        })),
        pacotes: pacotes.map((k) => ({
          titulo: k.title,
          sessoes: k.totalSessions,
          valorCentavos: k.priceCents,
          situacao: k.status,
          criadoEm: iso(k.createdAt),
        })),
        outrasMensagens: outrasMensagens.map((m) => ({
          tipo: m.kind,
          situacao: m.status,
          enviadaEm: iso(m.createdAt),
        })),
        avaliacoes: avaliacoes.map((r) => ({
          nota: r.rating,
          comentario: r.comment,
          respondidaEm: iso(r.answeredAt),
        })),
        registroDeAcesso: acessos.map((a) => ({ acao: a.action, em: iso(a.createdAt) })),
      };
    });
  }

  /** Atende o pedido de exclusão. Devolve o que foi feito. */
  async erasePatient(ctx: TenantContext, patientId: string) {
    const { result, urls } = await this.run(ctx, async (tx) => {
      const [p] = await tx
        .select()
        .from(s.patients)
        .where(eq(s.patients.id, patientId))
        .for('update');
      if (!p) throw new NotFoundException('Paciente não encontrado');
      const conta = async (q: Promise<Array<{ n: number }>>) => (await q)[0]!.n;
      const n = sql<number>`count(*)::int`;
      const historico =
        (await conta(
          tx.select({ n }).from(s.clinicalNotes).where(eq(s.clinicalNotes.patientId, patientId)),
        )) +
        (await conta(
          tx.select({ n }).from(s.patientPhotos).where(eq(s.patientPhotos.patientId, patientId)),
        )) +
        (await conta(
          tx.select({ n }).from(s.toothChart).where(eq(s.toothChart.patientId, patientId)),
        )) +
        (await conta(
          tx
            .select({ n })
            .from(s.appointments)
            .where(
              and(
                eq(s.appointments.patientId, patientId),
                inArray(s.appointments.status, ['arrived', 'in_progress', 'done', 'no_show']),
              ),
            ),
        )) +
        (await conta(tx.select({ n }).from(s.charges).where(eq(s.charges.patientId, patientId)))) +
        (await conta(
          tx.select({ n }).from(s.treatmentPlans).where(eq(s.treatmentPlans.patientId, patientId)),
        )) +
        (await conta(
          tx
            .select({ n })
            .from(s.clinicalDocuments)
            .where(eq(s.clinicalDocuments.patientId, patientId)),
        )) +
        (await conta(
          tx
            .select({ n })
            .from(s.sessionPackages)
            .where(eq(s.sessionPackages.patientId, patientId)),
        ));

      // Fotos publicadas no site saem junto (a cópia pública é apagada).
      const galeria = await tx
        .delete(s.galleryItems)
        .where(eq(s.galleryItems.patientId, patientId))
        .returning();
      const urls = galeria.flatMap((g) => [g.beforeUrl, g.afterUrl]);

      if (historico === 0) {
        await tx.delete(s.patients).where(eq(s.patients.id, patientId));
        await recordAudit(tx, ctx, {
          unitId: null,
          action: 'patient.deleted',
          summary: 'Paciente apagado a pedido (LGPD), sem histórico clínico',
          details: {},
        });
        return { result: { mode: 'deleted' as const }, urls };
      }

      const agora = new Date();
      await tx
        .update(s.imageConsents)
        .set({ revokedAt: agora })
        .where(and(eq(s.imageConsents.patientId, patientId), isNull(s.imageConsents.revokedAt)));
      const canceladas = await tx
        .update(s.appointments)
        .set({
          status: 'cancelled',
          cancelReason: 'Pedido de exclusão de dados (LGPD)',
          manageTokenHash: null,
          updatedAt: agora,
        })
        .where(
          and(
            eq(s.appointments.patientId, patientId),
            inArray(s.appointments.status, ['scheduled', 'confirmed']),
            gt(s.appointments.startsAt, agora),
          ),
        )
        .returning({ id: s.appointments.id, status: s.appointments.status });
      for (const c of canceladas)
        await tx.insert(s.appointmentEvents).values({
          tenantId: ctx.tenantId,
          appointmentId: c.id,
          toStatus: 'cancelled',
          actorUserId: ctx.user.userId,
          reason: 'Pedido de exclusão de dados (LGPD)',
        });
      await tx
        .update(s.appointments)
        .set({ manageTokenHash: null })
        .where(eq(s.appointments.patientId, patientId));
      await tx
        .update(s.waitlist)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(s.waitlist.patientId, patientId),
            inArray(s.waitlist.status, ['waiting', 'offered']),
          ),
        );
      // Contato e observações administrativas saem; nome, CPF, nascimento e prontuário ficam
      // pela guarda legal, sem uso para mensagens.
      await tx
        .update(s.patients)
        .set({ phone: '', email: '', notes: '', contactErasedAt: agora })
        .where(eq(s.patients.id, patientId));
      await this.log(tx, ctx, patientId, 'erase');
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'patient.erased',
        summary:
          'Contato do paciente apagado a pedido (LGPD); prontuário mantido pela guarda legal',
        details: { patientId, cancelledAppointments: canceladas.length },
      });
      return {
        result: { mode: 'contact_erased' as const, cancelledAppointments: canceladas.length },
        urls,
      };
    });
    for (const u of urls) await this.media.remove(u);
    return result;
  }

  /**
   * Todos os dados da clínica, para levar a outro sistema. Credenciais (WhatsApp, Mercado
   * Pago, Focus) e senhas ficam de fora.
   */
  exportClinic(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const sem = <T extends Record<string, unknown>>(rows: T[], ...campos: string[]) =>
        rows.map((r) =>
          Object.fromEntries(
            Object.entries(r).filter(([k]) => !campos.includes(k) && k !== 'tenantId'),
          ),
        );
      const [t] = await tx.select().from(s.tenants);
      const tabela = async <T extends Record<string, unknown>>(
        q: Promise<T[]>,
        ...campos: string[]
      ) => sem(await q, ...campos);
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'clinic.exported',
        summary: 'Exportação completa dos dados da clínica',
        details: {},
      });
      return {
        geradoEm: new Date().toISOString(),
        clinica: sem([t!], 'id', 'tvTokenHash'),
        unidades: await tabela(tx.select().from(s.units)),
        salas: await tabela(tx.select().from(s.rooms)),
        profissionais: await tabela(tx.select().from(s.professionals)),
        servicos: await tabela(tx.select().from(s.services)),
        horarios: await tabela(tx.select().from(s.workingHours)),
        pacientes: await tabela(tx.select().from(s.patients)),
        consultas: await tabela(tx.select().from(s.appointments), 'manageTokenHash'),
        historicoDasConsultas: await tabela(tx.select().from(s.appointmentEvents)),
        listaDeEspera: await tabela(tx.select().from(s.waitlist)),
        // Evoluções sigilosas de outros profissionais saem sem o conteúdo (sigilo profissional).
        prontuario: (await tabela(tx.select().from(s.clinicalNotes))).map((n) =>
          n.private && n.authorUserId !== ctx.user.userId
            ? { ...n, data: {}, text: null, sigiloso: true }
            : n,
        ),
        odontograma: await tabela(tx.select().from(s.toothChart)),
        fotos: await tabela(tx.select().from(s.patientPhotos)),
        autorizacoesDeImagem: await tabela(tx.select().from(s.imageConsents)),
        orcamentos: await tabela(tx.select().from(s.treatmentPlans), 'approveTokenHash'),
        itensDeOrcamento: await tabela(tx.select().from(s.treatmentPlanItems)),
        cobrancas: await tabela(tx.select().from(s.charges)),
        contasAPagar: await tabela(tx.select().from(s.expenses)),
        fornecedores: await tabela(tx.select().from(s.suppliers)),
        materiais: await tabela(tx.select().from(s.stockItems)),
        lotes: await tabela(tx.select().from(s.stockLots)),
        movimentacoes: await tabela(tx.select().from(s.stockMoves)),
        convenios: await tabela(tx.select().from(s.insurers)),
        tabelaDosConvenios: await tabela(tx.select().from(s.insurerPrices)),
        carteirinhas: await tabela(tx.select().from(s.patientInsurances)),
        guias: await tabela(tx.select().from(s.insuranceAuthorizations)),
        lotesDeFaturamento: await tabela(tx.select().from(s.insuranceBatches)),
        guiasFaturadas: await tabela(tx.select().from(s.insuranceClaims)),
        notasFiscais: await tabela(tx.select().from(s.serviceInvoices)),
        documentosClinicos: await tabela(tx.select().from(s.clinicalDocuments)),
        pacotes: await tabela(tx.select().from(s.sessionPackages)),
        regrasDeRepasse: await tabela(tx.select().from(s.commissionRules)),
        mensagensAoPaciente: await tabela(tx.select().from(s.patientMessages)),
        avaliacoes: await tabela(tx.select().from(s.reviewRequests), 'tokenHash'),
        ofertasDaListaDeEspera: await tabela(tx.select().from(s.waitlistOffers), 'tokenHash'),
      };
    });
  }
}
