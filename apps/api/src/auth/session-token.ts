import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'tt_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Token de sessão: 256 bits aleatórios. Vai no cookie; o banco guarda só o hash. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  return readTokenCookie(cookieHeader, SESSION_COOKIE);
}

export function readTokenCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }
  return null;
}

function cookie(value: string, maxAge: number, name = SESSION_COOKIE): string {
  // httpOnly: o JavaScript da página não lê o cookie. SameSite=Lax: outros sites não
  // conseguem disparar POST com ele. Secure: só trafega em HTTPS (ligado em produção).
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const sessionCookie = (token: string, maxAge = SESSION_TTL_SECONDS): string =>
  cookie(token, maxAge);

export const clearedSessionCookie = (): string => cookie('', 0);
