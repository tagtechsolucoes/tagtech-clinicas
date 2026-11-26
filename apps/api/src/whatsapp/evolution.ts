/**
 * Cliente da Evolution API (WhatsApp pelo QR code). Ela roda no mesmo servidor, num
 * contêiner só para isso; cada loja é uma "instância" com o próprio número.
 */

export interface EvolutionConfig {
  url: string;
  apiKey: string;
  /** Endereço da nossa API visto de dentro da Evolution (rede do Docker). */
  hookBase: string;
}

/** Sem EVOLUTION_URL e EVOLUTION_API_KEY no servidor, o QR code fica indisponível. */
export function evolutionConfig(): EvolutionConfig | null {
  const url = process.env.EVOLUTION_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!url || !apiKey) return null;
  const hookBase = (process.env.EVOLUTION_HOOK_BASE ?? 'http://api:3000').replace(/\/+$/, '');
  return { url, apiKey, hookBase };
}

export type EvolutionState = 'open' | 'connecting' | 'close';

export interface QrCode {
  /** Imagem pronta (data:image/png;base64,…), quando a Evolution manda. */
  image: string | null;
  /** Texto do QR, para desenhar aqui mesmo se não vier imagem. */
  code: string | null;
  pairingCode: string | null;
}

export class EvolutionError extends Error {}

/** Só dígitos, sem o sufixo do WhatsApp (5581999998888@s.whatsapp.net -> 5581999998888). */
export const jidToPhone = (jid: string | undefined | null): string | null => {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  const d = jid.split('@')[0]!.split(':')[0]!;
  return /^[0-9]{10,15}$/.test(d) ? d : null;
};

export class Evolution {
  constructor(
    private readonly http: typeof fetch,
    private readonly cfg: EvolutionConfig,
  ) {}

  private async call<T>(method: string, path: string, body?: object): Promise<T> {
    let res: Response;
    try {
      res = await this.http(`${this.cfg.url}${path}`, {
        method,
        headers: { apikey: this.cfg.apiKey, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new EvolutionError('O serviço do WhatsApp não respondeu. Tente de novo.');
    }
    const data = (await res.json().catch(() => null)) as T & {
      response?: { message?: unknown };
      message?: unknown;
    };
    if (!res.ok) {
      const m = data?.response?.message ?? data?.message;
      const texto = Array.isArray(m) ? m.flat().join(' ') : typeof m === 'string' ? m : '';
      throw new EvolutionError(texto || `Serviço do WhatsApp: HTTP ${res.status}`);
    }
    return data;
  }

  /** Cria a instância da loja, já apontando o webhook para nós. */
  async create(instance: string, hookSecret: string): Promise<QrCode> {
    const r = await this.call<{
      qrcode?: { base64?: string; code?: string; pairingCode?: string };
    }>('POST', '/instance/create', {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      syncFullHistory: false,
      webhook: this.webhook(hookSecret),
      // Versões antigas da v2 leem os campos soltos.
      webhookUrl: this.hookUrl(hookSecret),
      webhookByEvents: false,
      webhookBase64: false,
      webhookEvents: EVENTS,
    });
    return toQr(r.qrcode);
  }

  /** Reaponta o webhook (instância que já existia). */
  async setWebhook(instance: string, hookSecret: string): Promise<void> {
    await this.call('POST', `/webhook/set/${encodeURIComponent(instance)}`, {
      webhook: this.webhook(hookSecret),
    });
  }

  /** QR code novo para ler no celular. */
  async connect(instance: string): Promise<QrCode> {
    const r = await this.call<{ base64?: string; code?: string; pairingCode?: string }>(
      'GET',
      `/instance/connect/${encodeURIComponent(instance)}`,
    );
    return toQr(r);
  }

  async state(instance: string): Promise<EvolutionState> {
    const r = await this.call<{ instance?: { state?: string } }>(
      'GET',
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    );
    const s = r.instance?.state;
    return s === 'open' ? 'open' : s === 'connecting' ? 'connecting' : 'close';
  }

  /** Número que leu o QR (só dígitos), quando já conectou. */
  async ownerPhone(instance: string): Promise<string | null> {
    const r = await this.call<Array<{ ownerJid?: string; owner?: string; number?: string }>>(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
    ).catch(() => []);
    const i = Array.isArray(r) ? r[0] : undefined;
    return jidToPhone(i?.ownerJid ?? i?.owner) ?? (i?.number?.replace(/\D/g, '') || null);
  }

  /** Desconecta o número e apaga a instância. Se ela já não existe, tudo bem. */
  async remove(instance: string): Promise<void> {
    const nome = encodeURIComponent(instance);
    await this.call('DELETE', `/instance/logout/${nome}`).catch(() => undefined);
    await this.call('DELETE', `/instance/delete/${nome}`).catch(() => undefined);
  }

  async sendText(instance: string, phone: string, text: string): Promise<string> {
    const r = await this.call<{ key?: { id?: string } }>(
      'POST',
      `/message/sendText/${encodeURIComponent(instance)}`,
      { number: phone, text, linkPreview: true },
    );
    return r.key?.id ?? '';
  }

  private hookUrl(secret: string) {
    return `${this.cfg.hookBase}/whatsapp/hook/${secret}`;
  }

  private webhook(secret: string) {
    return {
      enabled: true,
      url: this.hookUrl(secret),
      byEvents: false,
      base64: false,
      events: EVENTS,
    };
  }
}

const EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

const toQr = (r?: { base64?: string; code?: string; pairingCode?: string } | null): QrCode => ({
  image: r?.base64?.startsWith('data:image/') ? r.base64 : null,
  code: r?.code ?? null,
  pairingCode: r?.pairingCode ?? null,
});
