import { hash, verify } from '@node-rs/argon2';

// Argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, 2 iterações).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // hash em formato inválido conta como senha errada
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Gasta o mesmo tempo de uma conferência de senha de verdade. Usado quando o e-mail
 * não existe, para o tempo de resposta não revelar quais e-mails têm conta.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('senha-que-ninguem-usa');
  await verifyPassword(await dummyHash, password);
}
