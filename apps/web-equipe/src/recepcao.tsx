import { useCallback, useEffect, useState } from 'react';
import { api, linkTv, type QueueItem } from './api';
import { mensagem, usePainel } from './contexto';
import { hora } from './formato';
import { Avatar, Botao, Cabecalho, Icone } from './ui';

type Fila = { waiting: QueueItem[]; inProgress: QueueItem[]; late: QueueItem[]; next: QueueItem[] };

const minutosDesde = (iso: string | null, agora: number) =>
  iso ? Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000)) : null;

/** Recepção: quem chegou e há quanto tempo espera, quem está atrasado e o que vem. */
export function RecepcaoTela() {
  const { avisar, gerencia } = usePainel();
  const [fila, setFila] = useState<Fila | null>(null);
  const [agora, setAgora] = useState(Date.now());

  const carregar = useCallback(
    () =>
      api
        .queue()
        .then(setFila)
        .catch((e) => avisar(mensagem(e), 'erro')),
    [avisar],
  );
  useEffect(() => {
    void carregar();
    const t = setInterval(() => {
      setAgora(Date.now());
      void carregar();
    }, 20_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function chamar(x: QueueItem) {
    try {
      const c = await api.callPatient(x.id);
      avisar(`Chamando ${c.displayName} para ${c.destination}`);
      void carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  async function status(x: QueueItem, s: 'arrived' | 'in_progress') {
    try {
      await api.setStatus(x.id, s);
      void carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  async function abrirTv() {
    try {
      const { token } = await api.tvLink();
      window.open(linkTv(token), '_blank', 'noopener');
      avisar('TV conectada. Abra este link no navegador da TV; o link anterior parou de valer.');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Recepção"
        descricao="A fila de hoje. Chamar o paciente mostra o nome na TV da sala de espera."
        acoes={
          gerencia ? (
            <Botao onClick={abrirTv}>
              <Icone nome="tv" className="h-4 w-4" /> Conectar TV
            </Botao>
          ) : null
        }
      />
      {!fila ? (
        <div className="h-64 animate-pulse rounded-3xl bg-folha ring-1 ring-linha" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <section className="self-start rounded-3xl bg-petroleo p-5 text-white sm:p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">Na sala de espera</h2>
              <span className="font-display text-4xl tabular-nums">{fila.waiting.length}</span>
            </div>
            {fila.waiting.length ? (
              <ul className="mt-5 space-y-2.5">
                {fila.waiting.map((x) => {
                  const espera = minutosDesde(x.arrivedAt, agora) ?? 0;
                  return (
                    <li
                      key={x.id}
                      className="flex items-center gap-3 rounded-2xl bg-white/[0.07] p-3.5"
                    >
                      <Avatar nome={x.patientName} cor="#e9a23b" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{x.patientName}</span>
                        <span className="text-sm text-white/70">
                          {hora(x.startsAt)} · {x.serviceName} · {x.professionalName}
                        </span>
                      </span>
                      <span
                        className={`text-right text-sm tabular-nums ${espera >= 20 ? 'font-semibold text-ambar' : 'text-white/70'}`}
                      >
                        {espera} min
                        <span className="block text-xs text-white/50">esperando</span>
                      </span>
                      <Botao variante="destaque" tamanho="pequeno" onClick={() => chamar(x)}>
                        {x.lastCalledAt ? 'Chamar de novo' : 'Chamar'}
                      </Botao>
                      <Botao
                        tamanho="pequeno"
                        className="bg-white/10 text-white ring-0 hover:bg-white/20"
                        onClick={() => status(x, 'in_progress')}
                      >
                        Entrou
                      </Botao>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-5 text-white/70">Ninguém esperando agora.</p>
            )}
          </section>

          <div className="space-y-6">
            <Bloco
              titulo="Em atendimento"
              itens={fila.inProgress}
              vazio="Nenhum atendimento agora."
            />
            <Bloco
              titulo="Atrasados"
              itens={fila.late}
              vazio="Ninguém atrasado."
              destaque
              acao={(x) => (
                <Botao tamanho="pequeno" onClick={() => status(x, 'arrived')}>
                  Chegou
                </Botao>
              )}
            />
            <Bloco
              titulo="Próximos"
              itens={fila.next.slice(0, 8)}
              vazio="Fim da agenda de hoje."
              acao={(x) => (
                <Botao tamanho="pequeno" onClick={() => status(x, 'arrived')}>
                  Chegou
                </Botao>
              )}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Bloco({
  titulo,
  itens,
  vazio,
  destaque,
  acao,
}: {
  titulo: string;
  itens: QueueItem[];
  vazio: string;
  destaque?: boolean;
  acao?: (x: QueueItem) => React.ReactNode;
}) {
  return (
    <section>
      <h3
        className={`mb-2.5 text-sm font-semibold ${destaque && itens.length ? 'text-alerta' : 'text-nevoa'}`}
      >
        {titulo} {itens.length ? `· ${itens.length}` : ''}
      </h3>
      {itens.length ? (
        <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
          {itens.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`w-12 text-sm font-semibold tabular-nums ${destaque ? 'text-alerta' : ''}`}
              >
                {hora(x.startsAt)}
              </span>
              <span className="min-w-0 flex-1">
                <a
                  href={`#paciente/${x.patientId}`}
                  className="block truncate font-medium hover:underline"
                >
                  {x.patientName}
                </a>
                <span className="text-sm text-nevoa">
                  {x.serviceName} · {x.professionalName}
                  {x.roomName ? ` · ${x.roomName}` : ''}
                </span>
              </span>
              {acao ? acao(x) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-folha px-4 py-3 text-sm text-nevoa ring-1 ring-linha">
          {vazio}
        </p>
      )}
    </section>
  );
}
