import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** Transação já presa a uma clínica. É o único jeito de a API tocar em dados de negócio. */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roda `fn` numa transação em que só existem os dados da clínica `tenantId`.
 * O set_config com `true` vale só até o fim da transação, então a conexão volta
 * limpa para o pool e não vaza a clínica para a próxima requisição.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('tenantId inválido');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Endereço público do site (/c/<slug>) -> clínica. Desconhecido devolve null. */
export async function resolveClinicSlug(db: Db, slug: string): Promise<string | null> {
  const rows = await db.execute<{ id: string | null }>(
    sql`select resolve_clinic_slug(${slug}) as id`,
  );
  return rows[0]?.id ?? null;
}

/** Link do paciente (hash do token) -> clínica e consulta. */
export async function resolveAppointmentToken(
  db: Db,
  tokenHash: string,
): Promise<{ tenantId: string; appointmentId: string } | null> {
  const rows = await db.execute<{ tenant_id: string; appointment_id: string }>(
    sql`select tenant_id, appointment_id from resolve_appointment_token(${tokenHash})`,
  );
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, appointmentId: row.appointment_id } : null;
}

/** Token aleatório de 128 bits em base64url (22 caracteres), para links. */
export function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Consultas (de todas as clínicas) na hora do lembrete e ainda sem lembrete. */
export async function dueReminders(
  db: Db,
  now: Date,
): Promise<Array<{ tenantId: string; appointmentId: string }>> {
  const rows = await db.execute<{ tenant_id: string; appointment_id: string }>(
    sql`select tenant_id, appointment_id from due_reminders(${now.toISOString()}::timestamptz)`,
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, appointmentId: r.appointment_id }));
}

/** Link de aprovação do orçamento (hash do token) -> clínica e orçamento. */
export async function resolvePlanToken(
  db: Db,
  tokenHash: string,
): Promise<{ tenantId: string; planId: string } | null> {
  const rows = await db.execute<{ tenant_id: string; plan_id: string }>(
    sql`select tenant_id, plan_id from resolve_plan_token(${tokenHash})`,
  );
  const r = rows[0];
  return r ? { tenantId: r.tenant_id, planId: r.plan_id } : null;
}

/** Aviso do provedor de Pix -> clínica do pagamento. */
export async function resolvePixPayment(db: Db, id: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from resolve_pix_payment(${id}::uuid)`,
  );
  return rows[0]?.tenant_id ?? null;
}

/** Sinais de agendamento que venceram sem pagamento (todas as clínicas). */
export async function expiredDeposits(
  db: Db,
  now: Date,
): Promise<Array<{ tenantId: string; chargeId: string }>> {
  const rows = await db.execute<{ tenant_id: string; charge_id: string }>(
    sql`select tenant_id, charge_id from expired_deposits(${now.toISOString()}::timestamptz)`,
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, chargeId: r.charge_id }));
}

type Pair = { tenantId: string; id: string };
async function pairs(db: Db, fn: string, col: string, now: Date): Promise<Pair[]> {
  const rows = await db.execute<Record<string, string>>(
    sql.raw(`select tenant_id, ${col} from ${fn}('${now.toISOString()}'::timestamptz)`),
  );
  return rows.map((r) => ({ tenantId: r.tenant_id!, id: r[col]! }));
}

/** Ofertas da lista de espera vencidas (todas as clínicas). */
export const expiredOffers = (db: Db, now: Date) => pairs(db, 'expired_offers', 'offer_id', now);
/** Consultas cujo retorno já está na hora. */
export const dueRecalls = (db: Db, now: Date) => pairs(db, 'due_recalls', 'appointment_id', now);
/** Última consulta de quem sumiu há tempo demais. */
export const dueReactivations = (db: Db, now: Date) =>
  pairs(db, 'due_reactivations', 'appointment_id', now);
/** Consultas feitas que pedem avaliação. */
export const dueReviews = (db: Db, now: Date) => pairs(db, 'due_reviews', 'appointment_id', now);

export async function resolveOfferToken(db: Db, tokenHash: string): Promise<Pair | null> {
  const rows = await db.execute<{ tenant_id: string; offer_id: string }>(
    sql`select tenant_id, offer_id from resolve_offer_token(${tokenHash})`,
  );
  return rows[0] ? { tenantId: rows[0].tenant_id, id: rows[0].offer_id } : null;
}

export async function resolveReviewToken(db: Db, tokenHash: string): Promise<Pair | null> {
  const rows = await db.execute<{ tenant_id: string; review_id: string }>(
    sql`select tenant_id, review_id from resolve_review_token(${tokenHash})`,
  );
  return rows[0] ? { tenantId: rows[0].tenant_id, id: rows[0].review_id } : null;
}

/** Link da TV da recepção -> clínica. */
export async function resolveTvToken(db: Db, tokenHash: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from resolve_tv_token(${tokenHash})`,
  );
  return rows[0]?.tenant_id ?? null;
}
