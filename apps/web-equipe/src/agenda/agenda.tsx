import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, STATUS_LABELS, weekdayOf } from '@tagtech/domain';
import { api, type Appointment, type Professional, type TimeOff } from '../api';
import { aoPedirNovoAgendamento, consumirNovoAgendamento } from '../atalhos';
import { mensagem, usePainel } from '../contexto';
import { diaCurto, diaLongo, hoje, hora, inicioDoDia, minutoDoDia } from '../formato';
import { Avatar, Botao, Icone, Vazio } from '../ui';
import { Bloqueio } from './bloqueio';
import { Detalhe } from './detalhe';
import { Novo, type Sugestao } from './novo';

const ALTURA_HORA = 72; // px por hora

type Visao = 'dia' | 'semana';

interface Coluna {
  chave: string;
  dia: string;
  pro: Professional;
  titulo: string;
  subtitulo: string;
}

const ler = <T,>(k: string, padrao: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : padrao;
  } catch {
    return padrao;
  }
};
const guardar = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento */
  }
};

export function Agenda() {
  const { professionals, avisar } = usePainel();
  const [dia, setDia] = useState(hoje);
  const [visao, setVisao] = useState<Visao>(() => ler('tt:visao', 'dia'));
  const ativos = useMemo(() => professionals.filter((p) => p.active), [professionals]);
  const [proSemana, setProSemana] = useState<string>(() => ler('tt:pro-semana', ''));
  const [dados, setDados] = useState<{ appointments: Appointment[]; timeOff: TimeOff[] } | null>(
    null,
  );
  const [aberta, setAberta] = useState<Appointment | null>(null);
  const [novo, setNovo] = useState<Sugestao | null>(null);
  const [bloquear, setBloquear] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  // "Novo agendamento" pedido de outra tela (painel inicial, busca).
  useEffect(() => {
    const abrir = () => consumirNovoAgendamento() && setNovo({ dia: hoje() });
    abrir();
    return aoPedirNovoAgendamento(abrir);
  }, []);

  // Semana começa na segunda.
  const inicio = visao === 'dia' ? dia : addDays(dia, -((weekdayOf(dia) + 6) % 7));
  const dias = visao === 'dia' ? [dia] : Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const proDaSemana = ativos.find((p) => p.id === proSemana) ?? ativos[0];

  const carregar = useCallback(async () => {
    try {
      setDados(await api.agenda(inicioDoDia(dias[0]!), inicioDoDia(addDays(dias.at(-1)!, 1))));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, visao, avisar]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => {
      setAgora(Date.now());
      void carregar();
    }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const consultas = useMemo(
    () => (dados?.appointments ?? []).filter((a) => a.status !== 'cancelled'),
    [dados],
  );

  const colunas: Coluna[] = useMemo(() => {
    if (visao === 'semana') {
      return proDaSemana
        ? dias.map((d) => ({
            chave: d,
            dia: d,
            pro: proDaSemana,
            titulo: diaCurto(d),
            subtitulo: d === hoje() ? 'Hoje' : '',
          }))
        : [];
    }
    const wd = weekdayOf(dia);
    return ativos
      .filter(
        (p) =>
          p.hours.some((h) => h.weekday === wd) ||
          consultas.some((a) => a.professional.id === p.id),
      )
      .map((p) => ({ chave: p.id, dia, pro: p, titulo: p.name, subtitulo: p.specialty }));
  }, [visao, proDaSemana, dias, dia, ativos, consultas]);

  // Faixa de horas: do primeiro turno ao último, cobrindo também consultas fora dele.
  const [deH, ateH] = useMemo(() => {
    let min = 24 * 60;
    let max = 0;
    for (const c of colunas) {
      for (const h of c.pro.hours.filter((x) => x.weekday === weekdayOf(c.dia))) {
        min = Math.min(min, h.start);
        max = Math.max(max, h.end);
      }
    }
    for (const a of consultas) {
      const d = dias.find(
        (x) => a.startsAt >= inicioDoDia(x) && a.startsAt < inicioDoDia(addDays(x, 1)),
      );
      if (!d) continue;
      min = Math.min(min, minutoDoDia(a.startsAt, d));
      max = Math.max(max, minutoDoDia(a.endsAt, d));
    }
    if (min > max) return [8, 18];
    return [Math.max(0, Math.floor(min / 60)), Math.min(24, Math.ceil(max / 60))];
  }, [colunas, consultas, dias]);

  // O resumo conta o que está na tela: na semana, só o profissional escolhido.
  const naTela = (a: Appointment) => visao === 'dia' || a.professional.id === proDaSemana?.id;
  const doDia = consultas.filter(naTela);
  const resumo = {
    total: doDia.length,
    confirmadas: doDia.filter((a) => a.status === 'confirmed').length,
    aguardando: doDia.filter((a) => a.status === 'scheduled').length,
    faltas: doDia.filter((a) => a.status === 'no_show').length,
    canceladas: (dados?.appointments ?? []).filter((a) => a.status === 'cancelled' && naTela(a))
      .length,
  };

  const mover = (n: number) => setDia(addDays(dia, visao === 'dia' ? n : 7 * n));
  const trocarVisao = (v: Visao) => {
    setVisao(v);
    guardar('tt:visao', v);
  };

  const titulo = visao === 'dia' ? diaLongo(dia) : `${diaCurto(dias[0]!)} a ${diaCurto(dias[6]!)}`;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col lg:h-dvh">
      <header className="border-b border-linha bg-folha/90 px-4 pt-3 pb-3 backdrop-blur sm:px-5 sm:pt-6 sm:pb-4 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => mover(-1)}
              className="grid h-10 w-10 place-items-center rounded-xl hover:bg-trilho"
            >
              <Icone nome="esquerda" />
            </button>
            <button
              type="button"
              aria-label="Próximo"
              onClick={() => mover(1)}
              className="grid h-10 w-10 place-items-center rounded-xl hover:bg-trilho"
            >
              <Icone nome="direita" />
            </button>
          </div>
          <h1 className="min-w-0 text-[1.45rem] leading-none font-bold first-letter:uppercase sm:text-[1.9rem]">
            {titulo}
          </h1>
          {dia !== hoje() ? (
            <Botao tamanho="pequeno" onClick={() => setDia(hoje())}>
              Hoje
            </Botao>
          ) : null}
          <label className="relative hidden sm:block">
            <span className="sr-only">Escolher data</span>
            <input
              type="date"
              value={dia}
              onChange={(e) => e.target.value && setDia(e.target.value)}
              className="h-9 rounded-lg bg-porcelana px-2.5 text-sm text-nevoa ring-1 ring-linha"
            />
          </label>
          <div className="flex w-full items-center gap-2.5 sm:ml-auto sm:w-auto">
            <div role="group" aria-label="Visão" className="flex rounded-xl bg-trilho p-1">
              {(['dia', 'semana'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visao === v}
                  onClick={() => trocarVisao(v)}
                  className={`h-8 rounded-lg px-3.5 text-sm font-semibold capitalize ${visao === v ? 'bg-folha text-tinta shadow-sm' : 'text-nevoa'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            {visao === 'semana' && ativos.length > 1 ? (
              <select
                aria-label="Profissional"
                value={proDaSemana?.id ?? ''}
                onChange={(e) => {
                  setProSemana(e.target.value);
                  guardar('tt:pro-semana', e.target.value);
                }}
                className="h-10 rounded-xl bg-folha px-3 text-sm font-medium ring-1 ring-linha"
              >
                {ativos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Botao onClick={() => setBloquear(true)} aria-label="Bloquear horário">
              <Icone nome="bloqueio" className="h-4 w-4" />
              <span className="hidden sm:inline">Bloquear</span>
            </Botao>
            <Botao
              variante="principal"
              className="ml-auto sm:ml-0"
              onClick={() => setNovo({ dia })}
            >
              <Icone nome="mais" className="h-4 w-4" />
              Agendar
            </Botao>
          </div>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm sm:mt-4 sm:gap-x-6">
          <Numero rotulo={resumo.total === 1 ? 'consulta' : 'consultas'} valor={resumo.total} />
          <Numero rotulo="confirmadas" valor={resumo.confirmadas} cor="text-ok" />
          <Numero
            rotulo="sem confirmar"
            valor={resumo.aguardando}
            cor={resumo.aguardando ? 'text-ambar-tinta' : undefined}
          />
          {resumo.faltas ? (
            <Numero
              rotulo={resumo.faltas === 1 ? 'falta' : 'faltas'}
              valor={resumo.faltas}
              cor="text-alerta"
            />
          ) : null}
          {resumo.canceladas ? (
            <Numero
              rotulo={resumo.canceladas === 1 ? 'cancelada' : 'canceladas'}
              valor={resumo.canceladas}
              cor="text-bruma"
            />
          ) : null}
        </dl>
      </header>

      {!ativos.length ? (
        <div className="p-8">
          <Vazio
            titulo="Ninguém atendendo ainda"
            texto="Cadastre os profissionais e a semana de trabalho de cada um para a agenda aparecer aqui."
            acao={
              <a href="#profissionais" className="font-semibold text-petroleo hover:underline">
                Cadastrar profissionais
              </a>
            }
          />
        </div>
      ) : !colunas.length ? (
        <div className="p-8">
          <Vazio
            titulo="Ninguém atende neste dia"
            texto="Nenhum profissional tem turno neste dia da semana. Use os botões acima para ir a outro dia."
          />
        </div>
      ) : (
        <Grade
          colunas={colunas}
          deH={deH}
          ateH={ateH}
          consultas={consultas}
          bloqueios={dados?.timeOff ?? []}
          agora={agora}
          aoAbrir={setAberta}
          aoVazio={(s) => setNovo(s)}
        />
      )}

      <Detalhe
        consulta={aberta}
        aoFechar={() => setAberta(null)}
        aoMudar={(a) => {
          setAberta(a);
          void carregar();
        }}
      />
      <Novo
        sugestao={novo}
        aoFechar={() => setNovo(null)}
        aoAgendar={(a) => {
          setNovo(null);
          void carregar();
          setAberta(a);
        }}
      />
      <Bloqueio
        aberto={bloquear}
        dia={dia}
        aoFechar={() => setBloquear(false)}
        aoSalvar={() => void carregar()}
      />
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  cor,
}: {
  rotulo: string;
  valor: number;
  cor?: string | undefined;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className={`text-lg font-semibold tabular-nums ${cor ?? 'text-tinta'}`}>{valor}</dd>
      <dt className="text-nevoa">{rotulo}</dt>
    </div>
  );
}

function Grade({
  colunas,
  deH,
  ateH,
  consultas,
  bloqueios,
  agora,
  aoAbrir,
  aoVazio,
}: {
  colunas: Coluna[];
  deH: number;
  ateH: number;
  consultas: Appointment[];
  bloqueios: TimeOff[];
  agora: number;
  aoAbrir: (a: Appointment) => void;
  aoVazio: (s: Sugestao) => void;
}) {
  const horas = Array.from({ length: ateH - deH }, (_, i) => deH + i);
  const altura = (ateH - deH) * ALTURA_HORA;
  const y = (min: number) => ((min - deH * 60) / 60) * ALTURA_HORA;
  const larguraMin = colunas.length > 4 ? '11rem' : '14rem';

  return (
    <div className="rolagem-fina min-h-0 flex-1 overflow-auto">
      <div
        className="grid min-w-full"
        style={{
          gridTemplateColumns: `4rem repeat(${colunas.length}, minmax(${larguraMin}, 1fr))`,
        }}
      >
        {/* Cabeçalho das colunas */}
        <div className="sticky top-0 z-20 border-b border-linha bg-porcelana" />
        {colunas.map((c) => (
          <div
            key={c.chave}
            className="sticky top-0 z-20 flex items-center gap-3 border-b border-l border-linha bg-porcelana px-4 py-3"
          >
            {c.dia === c.chave ? null : (
              <Avatar nome={c.pro.name} cor={c.pro.color} foto={c.pro.photoUrl} />
            )}
            <div className="min-w-0">
              <p
                className={`truncate font-semibold capitalize ${c.subtitulo === 'Hoje' ? 'text-petroleo' : ''}`}
              >
                {c.titulo}
              </p>
              {c.subtitulo ? <p className="truncate text-xs text-nevoa">{c.subtitulo}</p> : null}
            </div>
          </div>
        ))}

        {/* Régua de horas */}
        <div className="relative" style={{ height: altura }}>
          {horas.map((h) => (
            <span
              key={h}
              className="absolute right-3 -translate-y-1/2 text-xs font-medium text-bruma tabular-nums"
              style={{ top: y(h * 60) }}
            >
              {h > deH ? `${String(h).padStart(2, '0')}:00` : ''}
            </span>
          ))}
        </div>

        {colunas.map((c) => {
          const wd = weekdayOf(c.dia);
          const turnos = c.pro.hours.filter((h) => h.weekday === wd);
          const inicio = inicioDoDia(c.dia);
          const fim = inicioDoDia(addDays(c.dia, 1));
          const minhas = consultas.filter(
            (a) => a.professional.id === c.pro.id && a.startsAt >= inicio && a.startsAt < fim,
          );
          const meusBloqueios = bloqueios.filter(
            (b) =>
              (b.professionalId === null || b.professionalId === c.pro.id) &&
              b.startsAt < fim &&
              b.endsAt > inicio,
          );
          const agoraMin = Math.round((agora - new Date(inicio).getTime()) / 60_000);
          return (
            <div
              key={c.chave}
              className="grade-horas relative cursor-cell border-l border-linha bg-[repeating-linear-gradient(-45deg,transparent_0_8px,rgb(15_32_40/0.025)_8px_9px)]"
              style={{
                height: altura,
                ['--hora' as string]: `${ALTURA_HORA}px`,
                backgroundPositionY: `${y(deH * 60)}px`,
              }}
              onClick={(e) => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.turno)
                  return;
                const rect = e.currentTarget.getBoundingClientRect();
                const min = deH * 60 + ((e.clientY - rect.top) / ALTURA_HORA) * 60;
                const arred = Math.floor(min / 15) * 15;
                aoVazio({
                  dia: c.dia,
                  professionalId: c.pro.id,
                  hora: `${String(Math.floor(arred / 60)).padStart(2, '0')}:${String(arred % 60).padStart(2, '0')}`,
                });
              }}
            >
              {/* Turno de trabalho em branco; fora dele, o hachurado do fundo. */}
              {turnos.map((t, i) => (
                <div
                  key={i}
                  data-turno="1"
                  className="absolute inset-x-0 bg-folha/95"
                  style={{ top: y(t.start), height: y(t.end) - y(t.start) }}
                />
              ))}
              {meusBloqueios.map((b) => {
                const s = Math.max(minutoDoDia(b.startsAt, c.dia), deH * 60);
                const e = Math.min(minutoDoDia(b.endsAt, c.dia), ateH * 60);
                return (
                  <div
                    key={b.id}
                    className="hachura absolute inset-x-1 rounded-lg bg-trilho/80 px-2.5 py-1.5 text-xs font-medium text-nevoa ring-1 ring-linha"
                    style={{ top: y(s) + 1, height: Math.max(y(e) - y(s) - 2, 18) }}
                  >
                    {b.reason || 'Bloqueado'}
                  </div>
                );
              })}
              {minhas.map((a) => (
                <Bloco
                  key={a.id}
                  a={a}
                  top={y(minutoDoDia(a.startsAt, c.dia))}
                  height={y(minutoDoDia(a.endsAt, c.dia)) - y(minutoDoDia(a.startsAt, c.dia))}
                  aoAbrir={aoAbrir}
                />
              ))}
              {agoraMin >= deH * 60 && agoraMin <= ateH * 60 ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10"
                  style={{ top: y(agoraMin) }}
                >
                  <div className="h-0.5 bg-ambar" />
                  <div className="absolute -top-[5px] -left-[5px] h-3 w-3 rounded-full bg-ambar ring-2 ring-folha" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bloco({
  a,
  top,
  height,
  aoAbrir,
}: {
  a: Appointment;
  top: number;
  height: number;
  aoAbrir: (a: Appointment) => void;
}) {
  const curto = height < 48;
  const apagado = a.status === 'no_show' || a.status === 'done';
  return (
    <button
      type="button"
      onClick={() => aoAbrir(a)}
      className={`group absolute inset-x-1 z-[5] overflow-hidden rounded-xl px-2.5 text-left shadow-[0_1px_2px_rgb(15_32_40/0.08)] ring-1 transition-shadow hover:z-[6] hover:shadow-[0_8px_22px_-10px_rgb(15_32_40/0.45)] ${
        curto ? 'flex items-center gap-2 py-0.5' : 'py-2'
      } ${a.status === 'no_show' ? 'hachura' : ''} ${apagado ? 'opacity-70' : ''} ${
        a.status === 'in_progress'
          ? 'outline-2 outline-offset-[-2px] outline-petroleo'
          : a.status === 'arrived'
            ? 'outline-2 outline-offset-[-2px] outline-ambar'
            : ''
      } ${a.status === 'confirmed' ? 'pr-7' : ''}`}
      style={{
        top: top + 1,
        height: Math.max(height - 2, 22),
        background: `color-mix(in oklab, ${a.service.color} 13%, white)`,
        ['--tw-ring-color' as string]: `color-mix(in oklab, ${a.service.color} 35%, white)`,
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[0.72rem] font-semibold text-nevoa tabular-nums">
          {hora(a.startsAt)}
        </span>
        {a.patient.hasAlerts ? (
          <span title="Alergia ou medicamento na ficha" className="shrink-0 text-ambar-tinta">
            <Icone nome="alerta" className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <span className="truncate text-[0.88rem] font-semibold">{a.patient.name}</span>
      </span>
      {!curto ? (
        <>
          <span className="mt-0.5 block truncate text-xs text-nevoa">{a.service.name}</span>
          {height >= 76 ? (
            <span
              className={`mt-1.5 inline-block rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold ${STATUS_BLOCO[a.status]}`}
            >
              {STATUS_LABELS[a.status]}
              {a.source === 'online' ? ' · site' : ''}
            </span>
          ) : null}
        </>
      ) : null}
      {a.status === 'confirmed' ? (
        <span
          title="Confirmado"
          className="absolute top-2 right-2 grid h-4 w-4 place-items-center rounded-full bg-ok text-white"
        >
          <Icone nome="ok" className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}

const STATUS_BLOCO: Record<string, string> = {
  scheduled: 'bg-white/80 text-azul',
  confirmed: 'bg-white/80 text-ok',
  arrived: 'bg-ambar text-tinta',
  in_progress: 'bg-petroleo text-white',
  done: 'bg-white/70 text-nevoa',
  no_show: 'bg-alerta text-white',
  cancelled: 'bg-white/70 text-bruma',
};
