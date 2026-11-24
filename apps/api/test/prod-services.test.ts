import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mailer } from '../src/mail/mailer';
import { captureException, initMonitoring } from '../src/monitoring';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('e-mail em produção', () => {
  it('com RESEND_API_KEY envia pelo Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_teste');
    vi.stubEnv('MAIL_FROM', 'TagTech <nao-responda@exemplo.com>');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new Mailer().send({ to: 'ana@exemplo.com', subject: 'Oi', text: 'link' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_teste');
    expect(JSON.parse(init.body)).toEqual({
      from: 'TagTech <nao-responda@exemplo.com>',
      to: ['ana@exemplo.com'],
      subject: 'Oi',
      text: 'link',
    });
  });

  it('falha do Resend não derruba quem chamou', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_teste');
    vi.stubEnv('MAIL_FROM', 'x@exemplo.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('erro', { status: 500 })));
    await expect(
      new Mailer().send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('monitoramento', () => {
  it('manda o erro ao Sentry sem token no caminho', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://chave123@o1.ingest.sentry.io/42');
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(initMonitoring()).toBe(true);
    await captureException(new Error('quebrou'), {
      method: 'POST',
      path: '/invites/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg/accept?x=1',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://o1.ingest.sentry.io/api/42/envelope/?sentry_key=chave123');
    const [, , evento] = (init.body as string).split('\n');
    const e = JSON.parse(evento!);
    expect(e.exception.values[0]).toEqual({ type: 'Error', value: 'quebrou' });
    expect(e.transaction).toBe('/invites/:token/accept');
  });
});
