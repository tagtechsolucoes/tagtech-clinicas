import { formatPhoneBR, WHATSAPP_TEMPLATE_BODY } from '@tagtech/domain';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { api, type WhatsAppQr, type WhatsAppSettings } from './api';
import { mensagem, usePainel } from './contexto';
import { Botao, Campo, Entrada, Icone, Interruptor, Seletor } from './ui';

const telefone = (d: string) => (d.startsWith('55') && d.length >= 12 ? formatPhoneBR(d) : d);

/**
 * WhatsApp da clínica. Dois jeitos: QR code (o número da recepção, lido como no WhatsApp
 * Web, que também recebe e responde pela central de conversas) ou a API oficial da Meta,
 * com modelos aprovados, só para mensagens automáticas. O token da Meta nunca volta.
 */
export function WhatsAppConfig() {
  const { vinculo, avisar } = usePainel();
  const dono = vinculo.role === 'owner';
  const [cfg, setCfg] = useState<WhatsAppSettings | null>(null);
  const [modo, setModo] = useState<'escolher' | 'meta' | 'qr'>('escolher');
  const [qr, setQr] = useState<WhatsAppQr['qr']>(null);
  const [teste, setTeste] = useState('');
  const [ocupado, setOcupado] = useState<null | 'qr' | 'sair'>(null);

  useEffect(() => {
    api.whatsapp().then(setCfg, (e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);

  // Enquanto o QR está na tela, confere a cada 3 s se o celular já leu (e renova o código).
  const lendo = modo === 'qr' && cfg?.provider === 'evolution' && cfg.connection !== 'open';
  useEffect(() => {
    if (!lendo) return;
    let vivo = true;
    const t = setInterval(() => {
      api.whatsappQr().then(
        (r) => {
          if (!vivo) return;
          setCfg(r);
          if (r.qr) setQr(r.qr);
          if (r.connection === 'open') {
            setModo('escolher');
            setQr(null);
            avisar('WhatsApp conectado');
          }
        },
        () => undefined,
      );
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [lendo, avisar]);

  const gerarQr = useCallback(async () => {
    setOcupado('qr');
    try {
      const r = await api.startWhatsappQr();
      setCfg(r);
      setQr(r.qr);
      setModo('qr');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setOcupado(null);
    }
  }, [avisar]);

  if (!cfg) return null;

  async function desconectar() {
    setOcupado('sair');
    try {
      setCfg(await api.removeWhatsapp());
      setModo('escolher');
      setQr(null);
      avisar('WhatsApp desconectado');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setOcupado(null);
    }
  }

  const conectado =
    cfg.configured && (cfg.provider === 'meta' || cfg.connection === 'open') && modo !== 'meta';
  const caiu =
    cfg.configured && cfg.provider === 'evolution' && cfg.connection !== 'open' && modo !== 'qr';

  return (
    <div className="space-y-5">
      {conectado ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ok-fundo px-4 py-3 text-ok">
          <Icone nome="whatsapp" className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              {cfg.displayPhone ? telefone(cfg.displayPhone) : 'Número conectado'}
            </span>
            <span className="text-ok/80">
              {cfg.provider === 'evolution' ? ' · conectado por QR code' : ' · API oficial da Meta'}
              {cfg.enabled ? '' : ' · mensagens pausadas'}
            </span>
          </span>
          {dono ? (
            <span className="flex gap-2">
              {cfg.provider === 'meta' ? (
                <Botao tamanho="pequeno" onClick={() => setModo('meta')}>
                  Editar
                </Botao>
              ) : null}
              <Botao
                tamanho="pequeno"
                variante="perigo"
                disabled={ocupado !== null}
                onClick={() => void desconectar()}
              >
                {ocupado === 'sair' ? 'Desconectando…' : 'Desconectar'}
              </Botao>
            </span>
          ) : null}
        </div>
      ) : null}

      {caiu ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ambar-fundo px-4 py-3 text-ambar-tinta">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">O celular da clínica desconectou.</span> Leia o QR code
            de novo para voltar a mandar mensagens e receber as conversas.
          </p>
          {dono ? (
            <Botao
              tamanho="pequeno"
              variante="principal"
              disabled={ocupado !== null}
              onClick={() => void gerarQr()}
            >
              {ocupado === 'qr' ? 'Gerando…' : 'Ler QR code'}
            </Botao>
          ) : null}
        </div>
      ) : null}

      {!cfg.configured && modo === 'escolher' ? (
        <>
          <p className="text-sm text-nevoa">
            Sem conexão, a recepção ainda manda a confirmação pelo botão da consulta. Conectado, o
            sistema avisa sozinho ao agendar, remarcar e cancelar, e manda o lembrete antes da
            consulta.
          </p>
          {dono ? (
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                disabled={!cfg.qrAvailable || ocupado !== null}
                onClick={() => void gerarQr()}
                className="group flex flex-col items-start gap-2.5 rounded-2xl bg-folha p-5 text-left ring-1 ring-linha transition hover:ring-2 hover:ring-petroleo disabled:pointer-events-none disabled:opacity-55"
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="text-[1.05rem] font-bold">Conectar por QR code</span>
                  <span className="rounded-full bg-ambar px-2.5 py-0.5 text-xs font-bold text-tinta">
                    Mais simples
                  </span>
                </span>
                <span className="text-sm leading-relaxed text-nevoa">
                  Leia o código com o WhatsApp da recepção, como no WhatsApp Web. Mensagens
                  automáticas e as conversas dos pacientes no painel. Sem cadastro na Meta.
                </span>
                <span className="mt-auto pt-1 text-sm font-semibold text-petroleo underline-offset-4 group-hover:underline">
                  {!cfg.qrAvailable
                    ? 'Indisponível neste servidor'
                    : ocupado === 'qr'
                      ? 'Gerando o QR code…'
                      : 'Gerar QR code'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setModo('meta')}
                className="group flex flex-col items-start gap-2.5 rounded-2xl bg-porcelana p-5 text-left ring-1 ring-linha transition hover:ring-2 hover:ring-petroleo"
              >
                <span className="text-[1.05rem] font-bold">API oficial da Meta</span>
                <span className="text-sm leading-relaxed text-nevoa">
                  Para quem já tem o número na API do WhatsApp Business, com modelos aprovados. Só
                  as mensagens automáticas; as respostas ficam no WhatsApp.
                </span>
                <span className="mt-auto pt-1 text-sm font-semibold text-petroleo underline-offset-4 group-hover:underline">
                  Usar a API oficial
                </span>
              </button>
            </div>
          ) : (
            <p className="text-sm text-nevoa">Só o dono da clínica conecta o WhatsApp.</p>
          )}
        </>
      ) : null}

      {modo === 'qr' && cfg.provider === 'evolution' && cfg.connection !== 'open' ? (
        <LerQr qr={qr} cancelando={ocupado === 'sair'} aoCancelar={() => void desconectar()} />
      ) : null}

      {modo === 'meta' && dono ? (
        <FormMeta
          cfg={cfg}
          aoSalvar={(c) => {
            setCfg(c);
            setModo('escolher');
          }}
          aoCancelar={() => setModo('escolher')}
        />
      ) : null}

      {conectado && dono ? (
        <>
          <Interruptor
            ligado={cfg.enabled}
            aoMudar={async (v) => {
              try {
                setCfg(await api.toggleWhatsapp(v));
              } catch (e) {
                avisar(mensagem(e), 'erro');
              }
            }}
            rotulo="Mandar mensagens automáticas"
          />
          <Lembretes cfg={cfg} aoMudar={setCfg} />
          <div className="flex gap-2">
            <Entrada
              inputMode="tel"
              placeholder="Seu WhatsApp para um teste"
              value={teste}
              onChange={(e) => setTeste(e.target.value)}
            />
            <Botao
              disabled={!teste.trim()}
              onClick={async () => {
                try {
                  await api.testWhatsapp(teste);
                  avisar('Mensagem de teste enviada');
                } catch (e) {
                  avisar(mensagem(e), 'erro');
                }
              }}
            >
              Testar
            </Botao>
          </div>
        </>
      ) : null}

      {cfg.provider === 'evolution' || (!cfg.configured && modo === 'escolher' && dono) ? (
        <p className="text-xs leading-relaxed text-nevoa">
          Pelo QR code, use o número que os pacientes já conhecem e não mande mensagens em massa
          para quem nunca falou com a clínica: o WhatsApp bloqueia números que fazem isso.
        </p>
      ) : null}
    </div>
  );
}

const ANTES_HORAS = [2, 4, 12, 24, 48];
const NO_DIA = [
  { v: 30, rotulo: '30 minutos antes' },
  { v: 60, rotulo: '1 hora antes' },
  { v: 120, rotulo: '2 horas antes' },
  { v: 180, rotulo: '3 horas antes' },
];

/**
 * Quando saem os dois lembretes: o da véspera (pede confirmação) e o do dia, perto da hora,
 * com o endereço. Pelo QR code, o paciente confirma respondendo 1.
 */
function Lembretes({
  cfg,
  aoMudar,
}: {
  cfg: WhatsAppSettings;
  aoMudar: (c: WhatsAppSettings) => void;
}) {
  const { avisar } = usePainel();
  async function salvar(prefs: { reminderHours?: number; soonMinutes?: number | null }) {
    try {
      aoMudar(await api.whatsappPrefs(prefs));
      avisar('Lembretes salvos');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }
  const qr = cfg.provider === 'evolution';
  return (
    <div className="rounded-2xl bg-folha p-4 ring-1 ring-linha sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Lembrete com confirmação">
          <Seletor
            value={cfg.reminderHours}
            onChange={(e) => void salvar({ reminderHours: Number(e.target.value) })}
          >
            {ANTES_HORAS.map((h) => (
              <option key={h} value={h}>
                {h} horas antes
              </option>
            ))}
          </Seletor>
        </Campo>
        <Campo rotulo="Lembrete do dia, com o endereço">
          <Seletor
            value={cfg.soonMinutes ?? ''}
            onChange={(e) =>
              void salvar({ soonMinutes: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">Não mandar</option>
            {NO_DIA.filter((o) => o.v < cfg.reminderHours * 60).map((o) => (
              <option key={o.v} value={o.v}>
                {o.rotulo}
              </option>
            ))}
          </Seletor>
        </Campo>
      </div>
      <p className="mt-3 flex gap-2 text-sm leading-relaxed text-nevoa">
        <Icone nome="whatsapp" className="mt-0.5 h-4 w-4 shrink-0 text-petroleo" />
        {qr ? (
          <span>
            O paciente confirma respondendo <b className="text-tinta">1</b>, e a consulta fica
            confirmada na agenda na hora. Se responder <b className="text-tinta">2</b>, a conversa
            fica marcada para a recepção combinar outro horário.
          </span>
        ) : (
          <span>
            Pela API oficial, o paciente confirma pelo link da mensagem. Para confirmar respondendo
            1, conecte o número por QR code.
          </span>
        )}
      </p>
    </div>
  );
}

function LerQr({
  qr,
  cancelando,
  aoCancelar,
}: {
  qr: WhatsAppQr['qr'];
  cancelando: boolean;
  aoCancelar: () => void;
}) {
  const [imagem, setImagem] = useState<string | null>(null);
  useEffect(() => {
    if (!qr?.code) {
      setImagem(qr?.image ?? null);
      return;
    }
    QRCode.toDataURL(qr.code, { margin: 1, width: 464, color: { dark: '#0f2028' } }).then(
      setImagem,
      () => setImagem(qr.image),
    );
  }, [qr?.code, qr?.image]);

  return (
    <div className="grid items-center gap-6 rounded-2xl bg-porcelana p-5 md:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <ol className="space-y-3 text-[0.95rem]">
          {[
            'Abra o WhatsApp no celular da recepção.',
            'Toque em Mais opções (⋮) ou Configurações e entre em Aparelhos conectados.',
            'Toque em Conectar um aparelho e aponte a câmera para o código.',
          ].map((passo, i) => (
            <li key={passo} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-petroleo text-sm font-semibold text-white">
                {i + 1}
              </span>
              <span className="pt-0.5">{passo}</span>
            </li>
          ))}
        </ol>
        <p className="flex items-center gap-2 text-sm text-nevoa">
          <span className="h-2 w-2 animate-pulse rounded-full bg-ambar" aria-hidden="true" />
          Esperando a leitura. O código se renova sozinho.
        </p>
        <Botao tamanho="pequeno" disabled={cancelando} onClick={aoCancelar}>
          {cancelando ? 'Cancelando…' : 'Cancelar'}
        </Botao>
      </div>
      <div className="justify-self-center rounded-2xl bg-white p-3 ring-1 ring-linha">
        {imagem ? (
          <img
            src={imagem}
            width={232}
            height={232}
            alt="QR code para conectar o WhatsApp da clínica"
          />
        ) : (
          <div className="grid h-[232px] w-[232px] place-items-center text-sm text-nevoa">
            Preparando o código…
          </div>
        )}
      </div>
    </div>
  );
}

function FormMeta({
  cfg,
  aoSalvar,
  aoCancelar,
}: {
  cfg: WhatsAppSettings;
  aoSalvar: (c: WhatsAppSettings) => void;
  aoCancelar: () => void;
}) {
  const { avisar } = usePainel();
  const jaMeta = cfg.provider === 'meta';
  const [form, setForm] = useState({
    phoneNumberId: cfg.phoneNumberId,
    accessToken: '',
    templateName: cfg.templateName,
    templateLang: cfg.templateLang,
    reminderHours: cfg.reminderHours,
  });
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const { accessToken, ...resto } = form;
      const novo = await api.saveWhatsapp({
        ...resto,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        enabled: cfg.enabled || !cfg.configured,
      });
      aoSalvar(novo);
      avisar(`WhatsApp conectado${novo.displayPhone ? ` (${novo.displayPhone})` : ''}`);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="ID do número (Meta)">
          <Entrada
            inputMode="numeric"
            value={form.phoneNumberId}
            onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
            placeholder="Ex.: 123456789012345"
          />
        </Campo>
        <Campo rotulo={jaMeta ? 'Token (deixe vazio para manter)' : 'Token de acesso'}>
          <Entrada
            type="password"
            autoComplete="off"
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Nome do modelo aprovado">
          <Entrada
            value={form.templateName}
            onChange={(e) => setForm({ ...form, templateName: e.target.value })}
          />
        </Campo>
      </div>
      <details className="rounded-2xl bg-porcelana px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Texto para cadastrar o modelo na Meta
        </summary>
        <p className="mt-2 text-nevoa">
          Categoria Utilidade, idioma português (Brasil), com este corpo:
        </p>
        <p className="mt-2 rounded-xl bg-folha p-3 font-mono text-[0.82rem] ring-1 ring-linha">
          {WHATSAPP_TEMPLATE_BODY}
        </p>
      </details>
      <div className="flex flex-wrap gap-2.5">
        <Botao
          variante="principal"
          disabled={salvando || !form.phoneNumberId || (!jaMeta && !form.accessToken.trim())}
          onClick={() => void salvar()}
        >
          {salvando ? 'Conferindo com a Meta…' : jaMeta ? 'Salvar' : 'Conectar'}
        </Botao>
        <Botao variante="discreto" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}
