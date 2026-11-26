import { formatPhoneBR } from '@tagtech/domain';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  api,
  siteUrl,
  type ChatMessage,
  type Conversation,
  type ConversationList,
  type ConversationThread,
} from './api';
import { pedirNovoAgendamento } from './atalhos';
import { mensagem, usePainel } from './contexto';
import { dataHora } from './formato';
import { Botao, Cabecalho, campo, Icone } from './ui';

const telefone = (d: string) => (d.startsWith('55') && d.length >= 12 ? formatPhoneBR(d) : `+${d}`);
const nomeDe = (c: Conversation) => c.name.trim() || telefone(c.phone);
const iniciais = (c: Conversation) => {
  const partes = c.name.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return c.phone.slice(-2);
  return (partes[0]![0]! + (partes.length > 1 ? partes.at(-1)![0]! : '')).toUpperCase();
};
// Tons calmos para os avatares, pelo número: a mesma pessoa tem sempre a mesma cor.
const TONS = ['#e2edf0', '#fdf1dc', '#e8eefb', '#fbe8e9', '#e2f2e9', '#eee8f5'];
const tom = (phone: string) =>
  TONS[[...phone].reduce((s, ch) => s + ch.charCodeAt(0), 0) % TONS.length]!;

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function quando(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDia(d, hoje)) return horaDe(iso);
  if (mesmoDia(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function dia(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDia(d, hoje)) return 'Hoje';
  if (mesmoDia(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

/**
 * Central de conversas do WhatsApp da clínica: a lista à esquerda, a conversa à direita, e o
 * paciente desse número com as próximas consultas. Confere mensagens novas a cada poucos
 * segundos enquanto a tela está aberta.
 */
export function ConversasTela({ aoMudarNaoLidas }: { aoMudarNaoLidas: (n: number) => void }) {
  const { avisar } = usePainel();
  const [lista, setLista] = useState<ConversationList | null>(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [conversa, setConversa] = useState<ConversationThread | null>(null);
  const [nova, setNova] = useState(false);
  const abertaRef = useRef<string | null>(null);
  abertaRef.current = aberta;
  const buscaRef = useRef('');
  buscaRef.current = busca;

  const carregarLista = useCallback(async () => {
    try {
      const l = await api.conversations(buscaRef.current.trim());
      setLista(l);
      if (!buscaRef.current.trim())
        aoMudarNaoLidas(l.conversations.filter((c) => c.unread > 0).length);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }, [avisar, aoMudarNaoLidas]);

  const carregarConversa = useCallback(
    async (id: string) => {
      try {
        const t = await api.conversation(id);
        if (abertaRef.current !== id) return;
        setConversa(t);
        if (t.conversation.unread > 0 && document.visibilityState === 'visible') {
          await api.readConversation(id);
        }
      } catch (e) {
        avisar(mensagem(e), 'erro');
      }
    },
    [avisar],
  );

  useEffect(() => {
    const t = setTimeout(() => void carregarLista(), busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [busca, carregarLista]);

  useEffect(() => {
    setConversa(null);
    if (aberta) void carregarConversa(aberta);
  }, [aberta, carregarConversa]);

  // Mensagens novas: confere a lista e a conversa aberta a cada 5 s (só com a aba visível).
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void carregarLista();
      if (abertaRef.current) void carregarConversa(abertaRef.current);
    }, 5000);
    return () => clearInterval(t);
  }, [carregarLista, carregarConversa]);

  const atual = lista?.conversations.find((c) => c.id === aberta) ?? conversa?.conversation;

  return (
    <div>
      <Cabecalho
        titulo="Conversas"
        descricao="O que os pacientes mandam para o WhatsApp da clínica chega aqui. A recepção responde pelo painel, do número da clínica."
        acoes={
          lista?.canReply ? (
            <Botao variante="principal" onClick={() => setNova(true)}>
              <Icone nome="mais" className="h-4 w-4" />
              Nova conversa
            </Botao>
          ) : null
        }
      />

      {lista && !lista.canReply ? <AvisoConexao lista={lista} /> : null}

      <div className="grid h-[calc(100dvh-13rem)] min-h-[34rem] overflow-hidden rounded-3xl bg-folha ring-1 ring-linha lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside
          className={`min-h-0 flex-col border-linha lg:flex lg:border-r ${aberta ? 'hidden' : 'flex'}`}
        >
          <div className="border-b border-linha p-3">
            <label className="relative block">
              <span className="sr-only">Buscar conversa</span>
              <Icone
                nome="busca"
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-nevoa"
              />
              <input
                className={`${campo} h-11 bg-porcelana pl-10`}
                placeholder="Nome ou número"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
          </div>
          {nova ? (
            <NovaConversa
              aoFechar={() => setNova(false)}
              aoCriar={(c) => {
                setNova(false);
                setAberta(c.id);
                void carregarLista();
              }}
            />
          ) : null}
          <ul className="rolagem-fina min-h-0 flex-1 overflow-y-auto p-2">
            {lista?.conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAberta(c.id)}
                  aria-current={c.id === aberta ? 'true' : undefined}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-porcelana aria-[current]:bg-agua"
                >
                  <Avatar c={c} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-[0.97rem] ${c.unread ? 'font-bold' : 'font-semibold'}`}
                      >
                        {nomeDe(c)}
                      </span>
                      <span
                        className={`shrink-0 text-xs tabular-nums ${c.unread ? 'font-semibold text-petroleo' : 'text-nevoa'}`}
                      >
                        {quando(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${c.unread ? 'text-tinta' : 'text-nevoa'}`}
                      >
                        {c.lastDirection === 'out' ? 'Você: ' : ''}
                        {c.lastPreview || 'Sem mensagens ainda'}
                      </span>
                      {c.unread ? (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-ambar px-1.5 text-xs font-bold text-tinta tabular-nums">
                          {c.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {lista && lista.conversations.length === 0 ? (
              <li className="px-4 py-10 text-center text-[0.95rem] text-nevoa">
                {busca.trim()
                  ? 'Nenhuma conversa com esse nome ou número.'
                  : 'Quando um paciente mandar mensagem para a clínica, ela aparece aqui.'}
              </li>
            ) : null}
          </ul>
        </aside>

        <section className={`min-h-0 flex-col ${aberta ? 'flex' : 'hidden lg:flex'}`}>
          {aberta && atual ? (
            <Conversa
              key={aberta}
              c={atual}
              thread={conversa}
              podeResponder={lista?.canReply ?? false}
              aoVoltar={() => setAberta(null)}
              aoEnviar={() => {
                void carregarConversa(aberta);
                void carregarLista();
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <Icone nome="whatsapp" className="h-11 w-11 text-linha" />
              <p className="max-w-[30ch] text-[0.95rem] text-nevoa">
                Escolha uma conversa para ler e responder.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AvisoConexao({ lista }: { lista: ConversationList }) {
  const texto =
    lista.provider === 'evolution'
      ? {
          titulo: 'O celular da clínica desconectou.',
          corpo: 'Leia o QR code de novo para voltar a receber e responder as mensagens.',
          botao: 'Ler QR code',
        }
      : lista.provider === 'meta'
        ? {
            titulo: 'Pela API oficial, aqui aparecem só as mensagens automáticas.',
            corpo:
              'Para receber e responder os pacientes pelo painel, conecte o número por QR code.',
            botao: 'Conectar por QR code',
          }
        : {
            titulo: 'O WhatsApp da clínica ainda não está conectado.',
            corpo: 'Conecte o número da recepção por QR code e as conversas passam a chegar aqui.',
            botao: 'Conectar WhatsApp',
          };
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ambar-fundo px-5 py-4 text-ambar-tinta">
      <p className="max-w-[62ch] text-[0.95rem]">
        <span className="font-semibold">{texto.titulo}</span> {texto.corpo}
      </p>
      <Botao
        variante="principal"
        onClick={() => {
          location.hash = '#clinica';
        }}
      >
        {texto.botao}
      </Botao>
    </div>
  );
}

function Avatar({ c }: { c: Conversation }) {
  return (
    <span
      aria-hidden="true"
      style={{ background: tom(c.phone) }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[0.92rem] font-semibold text-tinta"
    >
      {iniciais(c)}
    </span>
  );
}

function Conversa({
  c,
  thread,
  podeResponder,
  aoVoltar,
  aoEnviar,
}: {
  c: Conversation;
  thread: ConversationThread | null;
  podeResponder: boolean;
  aoVoltar: () => void;
  aoEnviar: () => void;
}) {
  const { avisar, clinic } = usePainel();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement | null>(null);
  const caixa = useRef<HTMLTextAreaElement | null>(null);

  const mensagens = useMemo(() => thread?.messages ?? [], [thread]);
  const ultima = mensagens.at(-1)?.id;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [ultima]);

  // Caixa de texto cresce com o que é escrito, até umas seis linhas.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [texto]);

  const grupos = useMemo(() => {
    const g: Array<{ dia: string; itens: ChatMessage[] }> = [];
    for (const m of mensagens) {
      const d = dia(m.createdAt);
      if (g.at(-1)?.dia !== d) g.push({ dia: d, itens: [] });
      g.at(-1)!.itens.push(m);
    }
    return g;
  }, [mensagens]);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await api.sendMessage(c.id, t);
      setTexto('');
    } catch (causa) {
      avisar(mensagem(causa), 'erro');
    } finally {
      setEnviando(false);
      aoEnviar();
      caixa.current?.focus();
    }
  }

  // Número de uma pessoa só: é esse paciente. Vários (família no mesmo número): escolhe.
  const pacientes = thread?.patients ?? [];
  const paciente = pacientes.length === 1 ? pacientes[0]! : null;
  const marcar = () =>
    pedirNovoAgendamento(
      paciente
        ? {
            patient: {
              ...paciente,
              email: '',
              birthDate: null,
              hasAlerts: false,
            },
          }
        : { novoPaciente: { name: c.name.trim(), phone: c.phone.replace(/^55/, '') } },
    );
  const linkAgendar = siteUrl(clinic.slug);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3 lg:px-6">
        <button
          type="button"
          onClick={aoVoltar}
          className="-ml-1 grid h-10 w-10 place-items-center rounded-xl hover:bg-porcelana lg:hidden"
        >
          <Icone nome="esquerda" className="h-4 w-4" />
          <span className="sr-only">Voltar para a lista</span>
        </button>
        <Avatar c={c} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.05rem] leading-tight font-bold">{nomeDe(c)}</p>
          <p className="truncate text-sm text-nevoa tabular-nums">
            {c.name.trim() ? telefone(c.phone) : 'Ainda não é paciente'}
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          {pacientes.map((p) => (
            <a
              key={p.id}
              href={`#paciente/${p.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-folha px-3 text-sm font-semibold ring-1 ring-linha hover:ring-tinta/35"
            >
              <Icone nome="pessoas" className="h-4 w-4" />
              {pacientes.length > 1 ? p.name.split(' ')[0] : 'Ficha'}
            </a>
          ))}
          <Botao tamanho="pequeno" variante="principal" onClick={marcar}>
            <Icone nome="agenda" className="h-4 w-4" />
            Marcar consulta
          </Botao>
        </span>
      </header>

      {thread?.appointments.length ? (
        <div className="rolagem-fina flex gap-2 overflow-x-auto border-b border-linha bg-porcelana/70 px-4 py-2.5 lg:px-6">
          <span className="shrink-0 self-center text-xs font-semibold text-nevoa">
            Próximas consultas
          </span>
          {thread.appointments.map((a) => (
            <span
              key={a.id}
              className="flex shrink-0 items-center gap-2 rounded-full bg-folha px-3 py-1 text-sm ring-1 ring-linha"
            >
              <span className="font-semibold tabular-nums">{dataHora(a.startsAt)}</span>
              <span className="text-nevoa">
                {a.service} · {a.professional}
              </span>
              {a.status === 'confirmed' ? (
                <span className="text-xs font-semibold text-ok">Confirmada</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rolagem-fina min-h-0 flex-1 overflow-y-auto bg-porcelana/60 px-4 py-5 lg:px-8">
        {thread === null ? (
          <p className="py-10 text-center text-sm text-nevoa">Carregando…</p>
        ) : mensagens.length === 0 ? (
          <p className="py-10 text-center text-[0.95rem] text-nevoa">
            Nenhuma mensagem ainda. Escreva abaixo para começar.
          </p>
        ) : (
          grupos.map((g) => (
            <div key={g.dia} className="space-y-1.5">
              <p className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full bg-folha px-3 py-1 text-xs font-semibold text-nevoa shadow-sm ring-1 ring-linha">
                  {g.dia}
                </span>
              </p>
              {g.itens.map((m) => (
                <Balao key={m.id} m={m} />
              ))}
            </div>
          ))
        )}
        <div ref={fim} />
      </div>

      {podeResponder ? (
        <form
          onSubmit={(e) => void enviar(e)}
          className="border-t border-linha bg-folha p-3 lg:px-5"
        >
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTexto((t) =>
                  t.trim()
                    ? `${t.trimEnd()}\n${linkAgendar}`
                    : `Você pode escolher o melhor horário por aqui: ${linkAgendar}`,
                );
                caixa.current?.focus();
              }}
              className="rounded-full bg-porcelana px-3 py-1.5 text-sm font-semibold text-tinta ring-1 ring-linha transition hover:ring-tinta/35"
            >
              Enviar link para agendar
            </button>
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Mensagem</span>
              <textarea
                ref={caixa}
                rows={1}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                placeholder="Escreva uma mensagem"
                className="block max-h-42 min-h-12 w-full resize-none rounded-2xl bg-porcelana px-4 py-3 text-base leading-snug text-tinta ring-1 ring-linha placeholder:text-bruma focus:bg-folha focus:ring-2 focus:ring-petroleo focus:outline-none"
              />
            </label>
            <Botao
              type="submit"
              variante="principal"
              className="h-12 w-12 shrink-0 !px-0"
              disabled={!texto.trim() || enviando}
              aria-label="Enviar"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  d="M3.5 10h12M10.5 4.5L16 10l-5.5 5.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Botao>
          </div>
          <p className="mt-1.5 hidden text-xs text-nevoa lg:block">
            Enter envia · Shift + Enter quebra a linha
          </p>
        </form>
      ) : (
        <p className="border-t border-linha bg-folha px-5 py-4 text-sm text-nevoa">
          Para responder daqui, o WhatsApp da clínica precisa estar conectado por QR code.
        </p>
      )}
    </>
  );
}

function Balao({ m }: { m: ChatMessage }) {
  const minha = m.direction === 'out';
  if (m.kind === 'auto') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(34rem,85%)] rounded-2xl rounded-br-md border border-dashed border-petroleo/30 bg-folha px-4 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-nevoa">
            <Icone nome="relogio" className="h-3.5 w-3.5" />
            Mensagem automática
          </p>
          <p className="text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
          <Rodape m={m} />
        </div>
      </div>
    );
  }
  return (
    <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[min(34rem,85%)] rounded-2xl px-4 py-2.5 ${
          minha
            ? 'rounded-br-md bg-petroleo text-white'
            : 'rounded-bl-md bg-folha text-tinta shadow-[0_1px_0_rgba(15,32,40,0.06)] ring-1 ring-linha'
        } ${m.status === 'failed' ? 'opacity-80' : ''}`}
      >
        <p
          className={`text-[0.97rem] leading-relaxed break-words whitespace-pre-wrap ${m.kind === 'media' ? 'italic opacity-80' : ''}`}
        >
          {m.body}
        </p>
        <Rodape m={m} />
      </div>
    </div>
  );
}

function Rodape({ m }: { m: ChatMessage }) {
  const minha = m.direction === 'out' && m.kind !== 'auto';
  return (
    <p
      className={`mt-1 flex items-center justify-end gap-1 text-[0.72rem] tabular-nums ${
        minha ? 'text-white/65' : 'text-nevoa'
      }`}
    >
      {m.status === 'failed' ? (
        <span className={`font-semibold ${minha ? 'text-[#ffc9cc]' : 'text-alerta'}`}>
          Não enviada ·
        </span>
      ) : null}
      {horaDe(m.createdAt)}
      {m.direction === 'out' && m.status !== 'failed' ? (
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-label={m.status === 'sending' ? 'Enviando' : 'Enviada'}
        >
          {m.status === 'sending' ? (
            <>
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 5v3l2 1.5" strokeLinecap="round" />
            </>
          ) : (
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      ) : null}
    </p>
  );
}

function NovaConversa({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: (c: Conversation) => void;
}) {
  const { avisar } = usePainel();
  const [phone, setPhone] = useState('');
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  return (
    <form
      className="space-y-2 border-b border-linha bg-porcelana/70 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSalvando(true);
        api
          .startConversation(phone, nome)
          .then(aoCriar, (c) => avisar(mensagem(c), 'erro'))
          .finally(() => setSalvando(false));
      }}
    >
      <input
        autoFocus
        className={`${campo} h-11`}
        inputMode="tel"
        placeholder="WhatsApp: (81) 99999-8888"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        className={`${campo} h-11`}
        placeholder="Nome (opcional)"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
      />
      <div className="flex gap-2">
        <Botao type="submit" variante="principal" disabled={salvando || !phone.trim()}>
          Abrir conversa
        </Botao>
        <Botao variante="discreto" onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
