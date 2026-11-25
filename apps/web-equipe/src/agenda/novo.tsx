import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type Appointment,
  type PatientSummary,
  type SessionPackage,
  type Slots,
} from '../api';
import { mensagem, usePainel } from '../contexto';
import { diaLongo, dinheiro, duracao, hoje, instante, telefone } from '../formato';
import { Avatar, Botao, Campo, Entrada, Gaveta, Icone, Seletor, Texto } from '../ui';

export interface Sugestao {
  dia: string;
  professionalId?: string;
  hora?: string;
  patient?: PatientSummary;
  serviceId?: string;
}

/** Novo agendamento pela recepção: paciente, serviço, profissional e horário. */
export function Novo({
  sugestao,
  aoFechar,
  aoAgendar,
}: {
  sugestao: Sugestao | null;
  aoFechar: () => void;
  aoAgendar: (a: Appointment) => void;
}) {
  return (
    <Gaveta
      aberta={sugestao !== null}
      aoFechar={aoFechar}
      titulo="Novo agendamento"
      subtitulo={sugestao ? diaLongo(sugestao.dia) : undefined}
    >
      {sugestao ? (
        <Formulario key={JSON.stringify(sugestao)} sugestao={sugestao} aoAgendar={aoAgendar} />
      ) : null}
    </Gaveta>
  );
}

function Formulario({
  sugestao,
  aoAgendar,
}: {
  sugestao: Sugestao;
  aoAgendar: (a: Appointment) => void;
}) {
  const { services, professionals, rooms, avisar } = usePainel();
  const ativosSvc = services.filter((s) => s.active);
  const [paciente, setPaciente] = useState<PatientSummary | null>(sugestao.patient ?? null);
  const [novoPaciente, setNovoPaciente] = useState<{ name: string; phone: string } | null>(null);
  const [serviceId, setServiceId] = useState(sugestao.serviceId ?? ativosSvc[0]?.id ?? '');
  const servico = services.find((s) => s.id === serviceId);
  const possiveis = useMemo(
    () =>
      professionals.filter(
        (p) =>
          p.active &&
          (!servico ||
            servico.professionalIds.length === 0 ||
            servico.professionalIds.includes(p.id)),
      ),
    [professionals, servico],
  );
  const [professionalId, setProfessionalId] = useState(sugestao.professionalId ?? '');
  const proEscolhido = possiveis.find((p) => p.id === professionalId) ?? possiveis[0];
  const [dia, setDia] = useState(sugestao.dia);
  const [horaEscolhida, setHoraEscolhida] = useState(sugestao.hora ?? '');
  const [encaixe, setEncaixe] = useState(false);
  const [livres, setLivres] = useState<Slots[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [notas, setNotas] = useState('');
  const [repetir, setRepetir] = useState(0); // 0 = não; 1 = toda semana; 2 = a cada 2 semanas
  const [vezes, setVezes] = useState(8);
  const [pacotes, setPacotes] = useState<SessionPackage[]>([]);
  const [packageId, setPackageId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [faltaMaterial, setFaltaMaterial] = useState<
    Array<{ itemId: string; name: string; unit: string; need: number; available: number }>
  >([]);
  // Aviso na hora: o procedimento tem material até esse dia?
  useEffect(() => {
    setFaltaMaterial([]);
    if (!serviceId || !horaEscolhida) return;
    api
      .stockCheck(serviceId, instante(dia, horaEscolhida))
      .then(setFaltaMaterial)
      .catch(() => undefined);
  }, [serviceId, dia, horaEscolhida]);

  useEffect(() => {
    if (!serviceId || !proEscolhido) return;
    setLivres(null);
    api
      .slots({ serviceId, date: dia, professionalId: proEscolhido.id })
      .then(setLivres)
      .catch(() => setLivres([]));
  }, [serviceId, dia, proEscolhido]);

  const horarios = livres?.flatMap((l) => l.times) ?? [];
  // Horário clicado na grade que não está livre vira encaixe automaticamente.
  useEffect(() => {
    if (livres && sugestao.hora && !horarios.includes(sugestao.hora)) setEncaixe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livres]);

  // Pacotes ativos do paciente para este serviço.
  useEffect(() => {
    setPackageId('');
    if (!paciente) return setPacotes([]);
    api
      .packages(paciente.id)
      .then((l) => {
        const uteis = l.filter(
          (p) => p.status === 'active' && p.serviceId === serviceId && p.free > 0,
        );
        setPacotes(uteis);
        if (uteis[0]) setPackageId(uteis[0].id);
      })
      .catch(() => setPacotes([]));
  }, [paciente, serviceId]);
  const pacote = pacotes.find((p) => p.id === packageId);

  async function agendar() {
    if (!servico || !proEscolhido || !horaEscolhida) return;
    setErro(null);
    setEnviando(true);
    try {
      const a = await api.book({
        ...(paciente ? { patientId: paciente.id } : { patient: novoPaciente! }),
        serviceId: servico.id,
        professionalId: proEscolhido.id,
        startsAt: instante(dia, horaEscolhida),
        ...(roomId ? { roomId } : {}),
        ...(notas.trim() ? { notes: notas.trim() } : {}),
        ...(encaixe ? { allowOutsideHours: true } : {}),
        ...(packageId ? { packageId } : {}),
        ...(repetir && (!pacote || pacote.free >= 2)
          ? { repeat: { everyWeeks: repetir, count: Math.min(vezes, pacote?.free ?? 52) } }
          : {}),
      });
      if (a.series) {
        const pul = a.series.skipped.length;
        avisar(
          `${a.series.created} sessões agendadas${pul ? `; ${pul} ${pul === 1 ? 'ficou' : 'ficaram'} de fora (${a.series.skipped[0]!.reason.toLowerCase()})` : ''}`,
          pul ? 'erro' : 'ok',
        );
      } else avisar('Consulta agendada');
      aoAgendar(a);
    } catch (e) {
      if (e instanceof ApiError && (e.reason === 'outside_hours' || e.reason === 'time_off'))
        setEncaixe(true);
      setErro(mensagem(e));
    } finally {
      setEnviando(false);
    }
  }

  const pacientePronto = paciente || (novoPaciente && novoPaciente.name.trim().length >= 2);

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-nevoa">Paciente</h3>
        {paciente ? (
          <div className="flex items-center gap-3 rounded-2xl bg-porcelana p-3.5">
            <Avatar nome={paciente.name} cor="#56676f" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{paciente.name}</p>
              <p className="text-sm text-nevoa">{telefone(paciente.phone) || 'Sem WhatsApp'}</p>
            </div>
            <Botao tamanho="pequeno" variante="discreto" onClick={() => setPaciente(null)}>
              Trocar
            </Botao>
          </div>
        ) : novoPaciente ? (
          <div className="space-y-3 rounded-2xl bg-porcelana p-4">
            <Campo rotulo="Nome completo">
              <Entrada
                autoFocus
                value={novoPaciente.name}
                onChange={(e) => setNovoPaciente({ ...novoPaciente, name: e.target.value })}
              />
            </Campo>
            <Campo rotulo="WhatsApp" ajuda="Para a confirmação e o lembrete.">
              <Entrada
                inputMode="tel"
                placeholder="(81) 99999-0000"
                value={novoPaciente.phone}
                onChange={(e) => setNovoPaciente({ ...novoPaciente, phone: e.target.value })}
              />
            </Campo>
            <button
              type="button"
              className="text-sm font-semibold text-petroleo hover:underline"
              onClick={() => setNovoPaciente(null)}
            >
              Buscar paciente cadastrado
            </button>
          </div>
        ) : (
          <BuscaPaciente
            aoEscolher={setPaciente}
            aoNovo={(name) => setNovoPaciente({ name, phone: '' })}
          />
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-nevoa">Consulta</h3>
        <Campo rotulo="Serviço">
          <Seletor value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {ativosSvc.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {duracao(s.durationMinutes)} · {dinheiro(s.priceCents)}
              </option>
            ))}
          </Seletor>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Profissional">
            <Seletor
              value={proEscolhido?.id ?? ''}
              onChange={(e) => setProfessionalId(e.target.value)}
            >
              {possiveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Data">
            <Entrada
              type="date"
              value={dia}
              min={hoje()}
              onChange={(e) => e.target.value && setDia(e.target.value)}
            />
          </Campo>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[0.82rem] font-semibold text-nevoa">Horário</span>
            <button
              type="button"
              className="text-sm font-semibold text-petroleo hover:underline"
              onClick={() => setEncaixe(!encaixe)}
            >
              {encaixe ? 'Ver horários livres' : 'Encaixe em outro horário'}
            </button>
          </div>
          {encaixe ? (
            <div className="space-y-2">
              <Entrada
                type="time"
                step={300}
                value={horaEscolhida}
                onChange={(e) => setHoraEscolhida(e.target.value)}
              />
              <p className="flex items-start gap-2 rounded-xl bg-ambar-fundo px-3 py-2.5 text-sm text-ambar-tinta">
                <Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" />
                Encaixe pode ficar fora do turno ou num bloqueio. Só não deixa marcar em cima de
                outra consulta.
              </p>
            </div>
          ) : livres === null ? (
            <p className="text-sm text-nevoa">Procurando horários…</p>
          ) : horarios.length ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {horarios.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={horaEscolhida === h}
                  onClick={() => setHoraEscolhida(h)}
                  className={`h-10 rounded-xl text-sm font-semibold tabular-nums ring-1 transition-colors ${
                    horaEscolhida === h
                      ? 'bg-petroleo text-white ring-petroleo'
                      : 'bg-folha ring-linha hover:ring-petroleo'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-porcelana px-4 py-3 text-sm text-nevoa">
              Sem horário livre neste dia. Tente outra data ou faça um encaixe.
            </p>
          )}
        </div>

        {rooms.some((r) => r.active) ? (
          <Campo rotulo="Sala (opcional)">
            <Seletor value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Sem sala definida</option>
              {rooms
                .filter((r) => r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Seletor>
          </Campo>
        ) : null}
        {pacotes.length ? (
          <Campo
            rotulo="Pacote"
            ajuda={
              pacote
                ? `Sobram ${pacote.free} de ${pacote.totalSessions} sessões para marcar. A sessão sai sem cobrança.`
                : 'Consulta avulsa, cobrada à parte.'
            }
          >
            <Seletor value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">Não usar pacote</option>
              {pacotes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · sobram {p.free}
                </option>
              ))}
            </Seletor>
          </Campo>
        ) : null}
        {!pacote || pacote.free >= 2 ? (
          <div className={`grid items-end gap-3 ${repetir ? 'grid-cols-[1fr_auto]' : ''}`}>
            <Campo rotulo="Repetir">
              <Seletor value={repetir} onChange={(e) => setRepetir(Number(e.target.value))}>
                <option value={0}>Não repetir</option>
                <option value={1}>Toda semana, mesmo horário</option>
                <option value={2}>A cada 2 semanas</option>
                <option value={4}>A cada 4 semanas</option>
              </Seletor>
            </Campo>
            {repetir ? (
              <Campo rotulo="Vezes">
                <Seletor
                  value={Math.min(vezes, pacote ? pacote.free : 52)}
                  onChange={(e) => setVezes(Number(e.target.value))}
                  className="w-28"
                >
                  {Array.from(
                    { length: (pacote ? Math.max(1, pacote.free) : 52) - 1 },
                    (_, i) => i + 2,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </Seletor>
              </Campo>
            ) : null}
          </div>
        ) : null}
        <Campo rotulo="Observação (opcional)">
          <Texto
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ex.: prefere ser atendida pela manhã"
          />
        </Campo>
      </section>

      {faltaMaterial.length ? (
        <p className="flex gap-2.5 rounded-xl bg-ambar-fundo px-4 py-3 text-sm text-ambar-tinta">
          <Icone nome="caixa" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Pode faltar material:</strong>{' '}
            {faltaMaterial
              .map((f) => `${f.name} (precisa ${f.need}, sobra ${f.available} ${f.unit})`)
              .join(', ')}
            . Dá para agendar; veja a lista de compras.
          </span>
        </p>
      ) : null}
      {erro ? (
        <p className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta">
          {erro}
        </p>
      ) : null}
      <Botao
        variante="principal"
        tamanho="grande"
        className="w-full"
        disabled={!pacientePronto || !horaEscolhida || enviando}
        onClick={agendar}
      >
        {horaEscolhida ? `Agendar às ${horaEscolhida}` : 'Escolha um horário'}
      </Botao>
    </div>
  );
}

export function BuscaPaciente({
  aoEscolher,
  aoNovo,
}: {
  aoEscolher: (p: PatientSummary) => void;
  aoNovo?: (nome: string) => void;
}) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<PatientSummary[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .patients(q, 8)
        .then(setLista)
        .catch(() => setLista([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <div className="relative">
        <Icone
          nome="busca"
          className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-bruma"
        />
        <Entrada
          autoFocus
          placeholder="Nome, WhatsApp ou CPF"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-10"
        />
      </div>
      <ul className="mt-2 divide-y divide-linha overflow-hidden rounded-2xl ring-1 ring-linha">
        {lista.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => aoEscolher(p)}
              className="flex w-full items-center gap-3 bg-folha px-3.5 py-2.5 text-left hover:bg-porcelana"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-sm text-nevoa">
                  {telefone(p.phone) || 'Sem WhatsApp'}
                </span>
              </span>
              {p.hasAlerts ? <Icone nome="alerta" className="h-4 w-4 text-ambar-tinta" /> : null}
            </button>
          </li>
        ))}
        {aoNovo ? (
          <li>
            <button
              type="button"
              onClick={() => aoNovo(q)}
              className="flex w-full items-center gap-2 bg-folha px-3.5 py-3 text-left font-semibold text-petroleo hover:bg-agua"
            >
              <Icone nome="mais" className="h-4 w-4" />
              {q.trim() ? `Cadastrar “${q.trim()}”` : 'Cadastrar paciente novo'}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
