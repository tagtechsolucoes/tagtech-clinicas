import { requireEnv } from './env';
import { runMigrations } from './migrations';

const applied = await runMigrations(requireEnv('DATABASE_OWNER_URL'));
console.log(
  applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está em dia.',
);
