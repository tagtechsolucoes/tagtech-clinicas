import { addDays, weekdayOf } from '@tagtech/domain';
import type { Appointment } from '../api';
import { diaLocal, hoje, hora } from '../formato';

const SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const nomeMes = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${ymd.slice(0, 7)}-15T12:00:00Z`),
  );

/** 42 dias (6 semanas, começando na segunda) que cobrem o mês de `ymd`. */
export function gradeDoMes(ymd: string) {
  const primeiro = `${ymd.slice(0, 7)}-01`;
  const inicio = addDays(primeiro, -((weekdayOf(primeiro) + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(inicio, i));
}

export const mesSeguinte = (ymd: string, n: number) => {
  const [y, m] = ymd.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

/** Calendário pequeno do menu da agenda: um ponto nos dias com consulta. */
export function MiniCalendario({
  dia,
  mes,
  setMes,
  aoEscolher,
  contagem,
  destaque,
}: {
  dia: string;
  mes: string;
  setMes: (m: string) => void;
  aoEscolher: (d: string) => void;
  contagem: Map<string, number>;
  /** Dias realçados (a semana na tela). */
  destaque: Set<string>;
}) {
  const grade = gradeDoMes(mes);
  const h = hoje();
  return (
    <div className="rounded-2xl bg-folha p-3.5 ring-1 ring-linha">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMes(mesSeguinte(mes, -1))}
          className="grid h-8 w-8 place-items-center rounded-lg text-nevoa hover:bg-trilho"
        >
          ‹
        </button>
        <p className="text-sm font-bold first-letter:uppercase">{nomeMes(mes)}</p>
        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => setMes(mesSeguinte(mes, 1))}
          className="grid h-8 w-8 place-items-center rounded-lg text-nevoa hover:bg-trilho"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[0.68rem] font-semibold text-bruma">
        {SEMANA.map((s, i) => (
          <span key={i} className="py-1">
            {s}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {grade.map((d) => {
          const fora = d.slice(0, 7) !== mes.slice(0, 7);
          const escolhido = d === dia;
          const n = contagem.get(d) ?? 0;
          return (
            <button
              key={d}
              type="button"
              onClick={() => aoEscolher(d)}
              aria-current={escolhido ? 'date' : undefined}
              aria-label={`${Number(d.slice(8))}${n ? `, ${n} consultas` : ''}`}
              className={`relative mx-auto grid h-8 w-8 place-items-center rounded-full text-[0.8rem] tabular-nums transition ${
                escolhido
                  ? 'bg-petroleo font-bold text-white'
                  : d === h
                    ? 'font-bold text-petroleo ring-1 ring-petroleo/40'
                    : destaque.has(d)
                      ? 'bg-agua font-semibold'
                      : fora
                        ? 'text-bruma/70 hover:bg-trilho'
                        : 'hover:bg-trilho'
              }`}
            >
              {Number(d.slice(8))}
              {n && !escolhido ? (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-ambar" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Visão de mês: até 3 consultas por dia; o resto vira "+N". Clicar abre o dia. */
export function Mes({
  mes,
  consultas,
  aoAbrirDia,
  aoAbrir,
}: {
  mes: string;
  consultas: Appointment[];
  aoAbrirDia: (d: string) => void;
  aoAbrir: (a: Appointment) => void;
}) {
  const grade = gradeDoMes(mes);
  const porDia = new Map<string, Appointment[]>();
  for (const a of [...consultas].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    const d = diaLocal(a.startsAt);
    porDia.set(d, [...(porDia.get(d) ?? []), a]);
  }
  const h = hoje();
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5 lg:px-8">
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl bg-linha ring-1 ring-linha [gap:1px]">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((s) => (
          <div key={s} className="bg-porcelana px-2 py-2 text-xs font-semibold text-nevoa">
            {s}
          </div>
        ))}
        {grade.map((d) => {
          const lista = porDia.get(d) ?? [];
          const fora = d.slice(0, 7) !== mes.slice(0, 7);
          return (
            <div
              key={d}
              className={`group flex min-h-[7.25rem] flex-col gap-1 p-1.5 ${fora ? 'bg-porcelana/70' : 'bg-folha'}`}
            >
              <button
                type="button"
                onClick={() => aoAbrirDia(d)}
                className={`flex items-center justify-between rounded-lg px-1.5 py-0.5 text-left text-sm tabular-nums hover:bg-trilho ${fora ? 'text-bruma' : ''}`}
              >
                <span
                  className={`grid h-6 min-w-6 place-items-center rounded-full font-semibold ${d === h ? 'bg-petroleo px-1.5 text-white' : ''}`}
                >
                  {Number(d.slice(8))}
                </span>
                {lista.length ? (
                  <span className="text-[0.68rem] font-semibold text-bruma">{lista.length}</span>
                ) : null}
              </button>
              {lista.slice(0, 3).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => aoAbrir(a)}
                  className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[0.75rem] hover:brightness-95 ${a.status === 'cancelled' ? 'line-through opacity-60' : ''}`}
                  style={{ background: `color-mix(in oklab, ${a.service.color} 14%, white)` }}
                >
                  <span
                    className="h-3 w-1 shrink-0 rounded-full"
                    style={{ background: a.service.color }}
                  />
                  <span className="shrink-0 font-semibold tabular-nums">{hora(a.startsAt)}</span>
                  <span className="truncate">{a.patient.name.split(' ')[0]}</span>
                </button>
              ))}
              {lista.length > 3 ? (
                <button
                  type="button"
                  onClick={() => aoAbrirDia(d)}
                  className="px-1.5 text-left text-[0.72rem] font-semibold text-petroleo hover:underline"
                >
                  +{lista.length - 3} mais
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Filtro por tipo de tratamento (categoria do serviço) e canceladas. */
export function Filtros({
  categorias,
  ocultas,
  setOcultas,
  verCanceladas,
  setVerCanceladas,
}: {
  categorias: Array<{ nome: string; cor: string; total: number }>;
  ocultas: string[];
  setOcultas: (v: string[]) => void;
  verCanceladas: boolean;
  setVerCanceladas: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 flex items-center justify-between px-1 text-[0.72rem] font-semibold text-bruma">
          Tipos de tratamento
          {ocultas.length ? (
            <button
              type="button"
              onClick={() => setOcultas([])}
              className="font-semibold text-petroleo hover:underline"
            >
              Mostrar todos
            </button>
          ) : null}
        </p>
        <ul className="space-y-0.5">
          {categorias.map((c) => {
            const ligado = !ocultas.includes(c.nome);
            return (
              <li key={c.nome}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm hover:bg-trilho">
                  <input
                    type="checkbox"
                    checked={ligado}
                    onChange={() =>
                      setOcultas(
                        ligado ? [...ocultas, c.nome] : ocultas.filter((x) => x !== c.nome),
                      )
                    }
                    className="sr-only"
                  />
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] ring-1 transition"
                    style={
                      ligado
                        ? { background: c.cor, ['--tw-ring-color' as string]: c.cor }
                        : { ['--tw-ring-color' as string]: 'var(--color-bruma)' }
                    }
                    aria-hidden
                  >
                    {ligado ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3 w-3 text-white"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={`flex-1 truncate ${ligado ? '' : 'text-bruma'}`}>{c.nome}</span>
                  <span className="text-xs text-bruma tabular-nums">{c.total || ''}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-sm hover:bg-trilho">
        Mostrar canceladas
        <input
          type="checkbox"
          checked={verCanceladas}
          onChange={(e) => setVerCanceladas(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-petroleo)]"
        />
      </label>
    </div>
  );
}
