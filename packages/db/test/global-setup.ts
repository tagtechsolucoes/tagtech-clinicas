import { runMigrations } from '../src/migrations';
import { OWNER_URL } from './urls';

export default async function setup(): Promise<void> {
  await runMigrations(OWNER_URL);
}
