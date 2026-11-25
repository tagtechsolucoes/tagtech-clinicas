import { createHash } from 'node:crypto';

/** O banco guarda só o hash do link do paciente. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
