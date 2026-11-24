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
