import { randomUUID } from 'node:crypto';
import { Catch, HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Envia erros ao Sentry pelo endpoint de "envelope", sem SDK (o SDK oficial puxa dezenas de
 * pacotes). Liga só com SENTRY_DSN. Nunca manda corpo de pedido, cookie nem cabeçalho:
 * senha, PIN e token ficam fora.
 */
const logger = new Logger('Monitoramento');
let alvo: { url: string; dsn: string } | null = null;

export function initMonitoring(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  const match = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn);
  if (!match) {
    logger.warn('SENTRY_DSN em formato inesperado; monitoramento desligado.');
    return false;
  }
  alvo = { url: `https://${match[2]}/api/${match[3]}/envelope/?sentry_key=${match[1]}`, dsn };
  process.on('unhandledRejection', (reason) => void captureException(reason));
  process.on('uncaughtException', (error) => void captureException(error));
  return true;
}

export async function captureException(
  error: unknown,
  context: { method?: string | undefined; path?: string | undefined } = {},
): Promise<void> {
  if (!alvo) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
    release: process.env.APP_VERSION,
    server_name: 'api',
    exception: { values: [{ type: err.name, value: err.message.slice(0, 1000) }] },
    // Só método e caminho, sem query string (pode ter token).
    tags: context.method ? { method: context.method } : undefined,
    transaction: context.path?.split('?')[0]?.replace(/[A-Za-z0-9_-]{30,}/g, ':token'),
    extra: { stack: err.stack?.slice(0, 8000) },
  };
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: alvo.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  try {
    await fetch(alvo.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    logger.warn('Não foi possível enviar o erro ao Sentry.');
  }
}

/** Erros 5xx e exceções inesperadas vão para o Sentry; 4xx (erro de quem chamou) não. */
@Catch()
export class MonitoringFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const request = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      void captureException(exception, { method: request?.method, path: request?.url });
    }
    super.catch(exception, host);
  }
}
