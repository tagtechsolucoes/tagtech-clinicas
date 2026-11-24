import { useState } from 'react';
import { fromMinutes, toMinutes, WEEKDAYS_PT, WEEKDAYS_SHORT } from '@tagtech/domain';
import { api, type Professional, type WorkHours } from './api';
import { mensagem, usePainel } from './contexto';
import {
  Avatar,
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  Gaveta,
  Icone,
  Interruptor,
  Texto,
  Vazio,
} from './ui';

export const CORES = [
  '#1d4e5f',
  '#3563c9',
  '#7a4fb8',
  '#c2417a',
  '#d0612c',
  '#b48a12',
  '#2a7f52',
  '#4b6470',
];

/** "seg a sex, 08:00–12:00 · sáb, 08:00–12:00": dias com a mesma faixa ficam juntos. */
export function resumoSemana(hours: WorkHours[]): string {
  if (!hours.length) return 'Sem horário definido';
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const porDia = new Map<number, string>();
  for (const h of [...hours].sort((a, b) => a.start - b.start)) {
    const faixa = `${fromMinutes(h.start)}–${fromMinutes(h.end)}`;
    porDia.set(h.weekday, porDia.has(h.weekday) ? `${porDia.get(h.weekday)} e ${faixa}` : faixa);
  }
  const grupos = new Map<string, number[]>();
  for (const d of ordem) {
    const f = porDia.get(d);
    if (f) grupos.set(f, [...(grupos.get(f) ?? []), d]);
  }
  const nomeDias = (dias: number[]) => {
    const pos = dias.map((d) => ordem.indexOf(d));
    const seguidos = pos.every((p, i) => i === 0 || p === pos[i - 1]! + 1);
    if (dias.length > 2 && seguidos)
      return `${WEEKDAYS_SHORT[dias[0]!]} a ${WEEKDAYS_SHORT[dias.at(-1)!]}`;
    const nomes = dias.map((d) => WEEKDAYS_SHORT[d]!);
    return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0]!;
  };
  return [...grupos].map(([faixa, dias]) => `${nomeDias(dias)}, ${faixa}`).join(' · ');
}

export function ProfissionaisTela() {
  const { professionals } = usePainel();
  const [aberto, setAberto] = useState<Professional | 'novo' | null>(null);
  return (
    <>
      <Cabecalho
        titulo="Profissionais"
        descricao="Quem atende, em que dias e horários. É daqui que saem os horários livres da agenda e do site."
        acoes={
          <Botao variante="principal" onClick={() => setAberto('novo')}>
            <Icone nome="mais" className="h-4 w-4" /> Novo profissional
          </Botao>
        }
      />
      {professionals.length === 0 ? (
        <Vazio
          titulo="Ninguém cadastrado"
          texto="Cadastre quem atende na clínica e a semana de trabalho de cada um."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {professionals.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setAberto(p)}
              className={`flex flex-col gap-4 rounded-3xl bg-folha p-5 text-left ring-1 ring-linha transition-shadow hover:shadow-[0_12px_30px_-18px_rgb(15_32_40/0.4)] ${p.active ? '' : 'opacity-60'}`}
            >
              <span className="flex items-center gap-3.5">
                <Avatar nome={p.name} cor={p.color} foto={p.photoUrl} tamanho="h-14 w-14 text-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{p.name}</span>
                  <span className="block truncate text-sm text-nevoa">
                    {[p.specialty, p.council].filter(Boolean).join(' · ') || 'Sem especialidade'}
                  </span>
                </span>
              </span>
              <span className="text-sm text-nevoa">{resumoSemana(p.hours)}</span>
              <span className="flex flex-wrap gap-2 text-xs font-semibold">
                {!p.active ? (
                  <span className="rounded-md bg-trilho px-2 py-1 text-nevoa">Inativo</span>
                ) : null}
                {p.active && p.onlineBooking ? (
                  <span className="rounded-md bg-agua px-2 py-1 text-petroleo">
                    Agenda pelo site
                  </span>
                ) : null}
                {p.active && !p.onlineBooking ? (
                  <span className="rounded-md bg-trilho px-2 py-1 text-nevoa">
                    Só pela recepção
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
      <Editor pro={aberto} aoFechar={() => setAberto(null)} />
    </>
  );
}

function Editor({ pro, aoFechar }: { pro: Professional | 'novo' | null; aoFechar: () => void }) {
  return (
    <Gaveta
      aberta={pro !== null}
      aoFechar={aoFechar}
      titulo={pro === 'novo' ? 'Novo profissional' : (pro?.name ?? '')}
    >
      {pro ? (
        <Formulario
          key={pro === 'novo' ? 'novo' : pro.id}
          pro={pro === 'novo' ? null : pro}
          aoFechar={aoFechar}
        />
      ) : null}
    </Gaveta>
  );
}

function Formulario({ pro, aoFechar }: { pro: Professional | null; aoFechar: () => void }) {
  const { clinic, recarregar, avisar } = usePainel();
  const unidades = clinic.units.filter((u) => u.active);
  const [dados, setDados] = useState({
    name: pro?.name ?? '',
    specialty: pro?.specialty ?? '',
    council: pro?.council ?? '',
    bio: pro?.bio ?? '',
    color: pro?.color ?? CORES[0]!,
    onlineBooking: pro?.onlineBooking ?? true,
    active: pro?.active ?? true,
  });
  const [horas, setHoras] = useState<WorkHours[]>(
    pro?.hours ??
      [1, 2, 3, 4, 5].flatMap((d) => [
        { unitId: unidades[0]?.id ?? '', weekday: d, start: 8 * 60, end: 12 * 60 },
        { unitId: unidades[0]?.id ?? '', weekday: d, start: 14 * 60, end: 18 * 60 },
      ]),
  );
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const salvo = pro
        ? await api.updateProfessional(pro.id, dados)
        : await api.createProfessional(dados);
      await api.setHours(salvo.id, horas);
      await recarregar();
      avisar('Profissional salvo');
      aoFechar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  const mudarTurno = (i: number, campo: 'start' | 'end', valor: string) =>
    setHoras(horas.map((h, j) => (j === i ? { ...h, [campo]: toMinutes(valor) } : h)));

  return (
    <div className="space-y-7">
      <div className="flex items-center gap-4">
        <Avatar
          nome={dados.name || '?'}
          cor={dados.color}
          foto={pro?.photoUrl ?? null}
          tamanho="h-16 w-16 text-xl"
        />
        {pro ? (
          <label className="cursor-pointer text-sm font-semibold text-petroleo hover:underline">
            {pro.photoUrl ? 'Trocar foto' : 'Enviar foto'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await api.setPhoto(pro.id, f);
                  await recarregar();
                  avisar('Foto atualizada');
                } catch (err) {
                  avisar(mensagem(err), 'erro');
                }
              }}
            />
          </label>
        ) : (
          <p className="text-sm text-nevoa">A foto entra depois de salvar.</p>
        )}
      </div>

      <div className="space-y-4">
        <Campo rotulo="Nome como o paciente conhece">
          <Entrada
            value={dados.name}
            onChange={(e) => setDados({ ...dados, name: e.target.value })}
            placeholder="Ex.: Dra. Lívia Mendes"
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Especialidade">
            <Entrada
              value={dados.specialty}
              onChange={(e) => setDados({ ...dados, specialty: e.target.value })}
              placeholder="Ex.: Ortodontia"
            />
          </Campo>
          <Campo rotulo="Registro no conselho">
            <Entrada
              value={dados.council}
              onChange={(e) => setDados({ ...dados, council: e.target.value })}
              placeholder="Ex.: CRO-PE 12.345"
            />
          </Campo>
        </div>
        <Campo rotulo="Apresentação no site">
          <Texto
            rows={3}
            maxLength={600}
            value={dados.bio}
            onChange={(e) => setDados({ ...dados, bio: e.target.value })}
          />
        </Campo>
        <div>
          <span className="mb-2 block text-[0.82rem] font-semibold text-nevoa">Cor na agenda</span>
          <div className="flex flex-wrap gap-2">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={dados.color === c}
                onClick={() => setDados({ ...dados, color: c })}
                className={`h-9 w-9 rounded-full ring-offset-2 transition ${dados.color === c ? 'ring-2 ring-tinta' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <Interruptor
          ligado={dados.onlineBooking}
          aoMudar={(v) => setDados({ ...dados, onlineBooking: v })}
          rotulo="Aparece no site de agendamento"
          descricao="Desligado, só a recepção marca com este profissional."
        />
        {pro ? (
          <Interruptor
            ligado={dados.active}
            aoMudar={(v) => setDados({ ...dados, active: v })}
            rotulo="Ativo"
            descricao="Inativo some da agenda e do site, mas o histórico fica."
          />
        ) : null}
      </div>

      <section>
        <h3 className="mb-1 font-semibold">Semana de trabalho</h3>
        <p className="mb-4 text-sm text-nevoa">
          Um ou mais turnos por dia. O intervalo entre turnos fica livre (almoço).
        </p>
        <div className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const turnos = horas.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === d);
            return (
              <div key={d} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="w-20 pt-2.5 text-sm font-semibold capitalize">
                  {WEEKDAYS_PT[d]}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {turnos.length === 0 ? (
                    <p className="pt-2.5 text-sm text-bruma">Não atende</p>
                  ) : null}
                  {turnos.map(({ h, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        value={fromMinutes(h.start)}
                        onChange={(e) => mudarTurno(i, 'start', e.target.value)}
                        className="h-10 w-28 rounded-lg bg-folha px-2 text-sm ring-1 ring-linha"
                      />
                      <span className="text-bruma">–</span>
                      <input
                        type="time"
                        step={300}
                        value={fromMinutes(Math.min(h.end, 1439))}
                        onChange={(e) => mudarTurno(i, 'end', e.target.value)}
                        className="h-10 w-28 rounded-lg bg-folha px-2 text-sm ring-1 ring-linha"
                      />
                      {unidades.length > 1 ? (
                        <select
                          aria-label="Unidade"
                          value={h.unitId}
                          onChange={(e) =>
                            setHoras(
                              horas.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)),
                            )
                          }
                          className="h-10 rounded-lg bg-folha px-2 text-sm ring-1 ring-linha"
                        >
                          {unidades.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Tirar turno"
                        onClick={() => setHoras(horas.filter((_, j) => j !== i))}
                        className="grid h-9 w-9 place-items-center rounded-lg text-bruma hover:bg-trilho hover:text-alerta"
                      >
                        <Icone nome="x" className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ultimo = turnos.at(-1)?.h;
                    const start = ultimo ? Math.min(ultimo.end + 60, 22 * 60) : 8 * 60;
                    setHoras([
                      ...horas,
                      {
                        unitId: unidades[0]?.id ?? '',
                        weekday: d,
                        start,
                        end: Math.min(start + 4 * 60, 23 * 60 + 55),
                      },
                    ]);
                  }}
                  className="mt-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-petroleo hover:bg-agua"
                >
                  + turno
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <Botao
        variante="principal"
        tamanho="grande"
        className="w-full"
        disabled={!dados.name.trim() || salvando}
        onClick={salvar}
      >
        Salvar
      </Botao>
    </div>
  );
}
