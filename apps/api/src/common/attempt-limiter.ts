import { HttpException, HttpStatus } from '@nestjs/common';

const MAX_ENTRIES = 50_000;

/**
 * Conta tentativas erradas por chave (IP + alvo) numa janela de tempo e bloqueia ao passar
 * do limite. Fica na memória do processo, o que basta com uma instância da API; com mais
 * de uma, o contador precisa ir para o Redis.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly options: { maxFailures: number; windowMs: number; message: string },
  ) {}

  private key(ip: string, target: string): string {
    return `${ip}|${target.trim().toLowerCase()}`;
  }

  assertAllowed(ip: string, target: string, now = Date.now()): void {
    const entry = this.failures.get(this.key(ip, target));
    if (entry && entry.resetAt > now && entry.count >= this.options.maxFailures) {
      throw new HttpException(this.options.message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(ip: string, target: string, now = Date.now()): void {
    const key = this.key(ip, target);
    const entry = this.failures.get(key);
    if (entry && entry.resetAt > now) {
      entry.count += 1;
      return;
    }
    if (this.failures.size >= MAX_ENTRIES) {
      for (const [k, v] of this.failures) if (v.resetAt <= now) this.failures.delete(k);
      if (this.failures.size >= MAX_ENTRIES) this.failures.clear();
    }
    this.failures.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }

  recordSuccess(ip: string, target: string): void {
    this.failures.delete(this.key(ip, target));
  }
}
