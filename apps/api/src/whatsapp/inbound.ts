import { jidToPhone, type EvolutionState } from './evolution';

/** O que a Evolution nos contou, já traduzido. Grupos, status e afins viram null. */
export type Inbound =
  | {
      type: 'message';
      phone: string;
      name: string;
      fromMe: boolean;
      externalId: string;
      body: string;
      media: boolean;
      at: Date;
    }
  | { type: 'connection'; state: EvolutionState; phone: string | null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const MIDIA: Record<string, string> = {
  imageMessage: 'Foto',
  videoMessage: 'Vídeo',
  audioMessage: 'Áudio',
  documentMessage: 'Arquivo',
  stickerMessage: 'Figurinha',
  locationMessage: 'Localização',
  contactMessage: 'Contato',
};

export function parseInbound(payload: unknown): Inbound | null {
  const p = obj(payload);
  const event = str(p.event).toLowerCase().replace(/_/g, '.');
  const data = obj(p.data);

  if (event === 'connection.update') {
    const s = str(data.state);
    const state: EvolutionState =
      s === 'open' ? 'open' : s === 'connecting' ? 'connecting' : 'close';
    return { type: 'connection', state, phone: jidToPhone(str(data.wuid)) };
  }
  if (event !== 'messages.upsert') return null;

  // Algumas versões mandam a lista inteira; pegamos a primeira.
  const m = obj(Array.isArray(p.data) ? p.data[0] : data);
  const key = obj(m.key);
  const jid = str(key.remoteJid);
  // Contas novas chegam com um identificador interno (@lid); o número vem ao lado.
  const phone =
    jidToPhone(jid) ??
    jidToPhone(str(key.remoteJidAlt)) ??
    jidToPhone(str(key.senderPn)) ??
    jidToPhone(str(m.senderPn));
  const externalId = str(key.id);
  if (!phone || !externalId) return null;

  const msg = obj(m.message);
  const texto =
    str(msg.conversation) ||
    str(obj(msg.extendedTextMessage).text) ||
    str(obj(msg.imageMessage).caption) ||
    str(obj(msg.videoMessage).caption) ||
    str(obj(msg.documentMessage).caption) ||
    str(obj(msg.buttonsResponseMessage).selectedDisplayText) ||
    str(obj(msg.listResponseMessage).title);
  const tipo = Object.keys(MIDIA).find((k) => k in msg);
  if (!texto && !tipo) return null; // reação, mensagem apagada, protocolo…

  const ts = Number(m.messageTimestamp);
  return {
    type: 'message',
    phone,
    name: str(m.pushName).slice(0, 120),
    fromMe: key.fromMe === true,
    externalId: externalId.slice(0, 200),
    body: (texto || `[${MIDIA[tipo!]}]`).slice(0, 4096),
    media: Boolean(tipo),
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
  };
}
