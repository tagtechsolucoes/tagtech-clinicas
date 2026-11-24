import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Número arbitrário e fixo que identifica a trava de migração deste sistema.
const MIGRATION_LOCK = 7_246_001;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Aplica, em ordem, os arquivos .sql de migrations/ que ainda não rodaram.
 * Cada arquivo roda numa transação: ou entra inteiro, ou não entra.
 * Precisa do usuário dono do banco (DATABASE_OWNER_URL), nunca do usuário do app.
 */
export async function runMigrations(ownerUrl: string): Promise<string[]> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    // Trava no banco: se dois processos migrarem ao mesmo tempo (deploy com duas
    // instâncias, suítes de teste em paralelo), o segundo espera o primeiro terminar.
    await sql`select pg_advisory_lock(${MIGRATION_LOCK})`;
    await sql`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK})`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}
