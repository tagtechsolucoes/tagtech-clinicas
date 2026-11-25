'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  addDays,
  formatBRL,
  localClock,
  toMinutes,
  WEEKDAYS_SHORT,
  weekdayOf,
} from '@tagtech/domain';
import { chamar, ApiError, type ManageView, type Pix, type PublicClinic } from '@/lib/api';
import { PixSinal } from './pix';
import { imagem } from '@/lib/tema';

type Slots = Array<{ professionalId: string; unitId: string; timezone: string; times: string[] }>;

const duracao = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
const preco = (c: number | null) => (c === null ? 'Valor na avaliação' : formatBRL(c));
const mes = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );
const diaLongo = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T12:00:00Z`));

/** O passo a passo de agendamento: serviço, profissional, dia e hora, dados. */
export function Agendar({
  clinic,
  servicoInicial,
}: {
  clinic: PublicClinic;
  /** Vem do link do lembrete de retorno (?servico=). */
  servicoInicial?: string | undefined;
}) {
  const tz = clinic.units[0]?.timezone ?? 'America/Recife';
  const hoje = localClock(new Date(), tz).ymd;
  const [serviceId, setServiceId] = useState<string | null>(
    clinic.services.some((s) => s.id === servicoInicial)
      ? servicoInicial!
      : clinic.services.length === 1
        ? clinic.services[0]!.id
        : null,
  );
  const servico = clinic.services.find((s) => s.id === serviceId);
  const pros = useMemo(
    () => clinic.professionals.filter((p) => !servico || servico.professionalIds.includes(p.id)),
    [clinic.professionals, servico],
  );
  // undefined = ainda não escolheu; null = sem preferência.
  const [professionalId, setProfessionalId] = useState<string | null | undefined>(undefined);
  const proEscolhido = clinic.professionals.find((p) => p.id === professionalId);
  const [inicio, setInicio] = useState(hoje);
  const [dias, setDias] = useState<Array<{ date: string; count: number }> | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [feito, setFeito] = useState<{
    token: string;
    appointment: ManageView;
    pix: Pix | null;
  } | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Depois de agendar, leva a pessoa para o recado de sucesso.
  useEffect(() => {
    if (feito) document.getElementById('agendar')?.scrollIntoView({ block: 'start' });
  }, [feito]);

  // Com um profissional só, pula a escolha.
  useEffect(() => {
    if (servico && pros.length === 1) setProfessionalId(pros[0]!.id);
  }, [servico, pros]);

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      serviceId: serviceId!,
      ...(professionalId ? { professionalId } : {}),
      ...extra,
    }).toString();

  useEffect(() => {
    if (!serviceId || professionalId === undefined) return;
    setDias(null);
    chamar<Array<{ date: string; count: number }>>(
      `/public/clinics/${clinic.slug}/days?${qs({ from: inicio, days: '14' })}`,
    )
      .then((d) => {
        setDias(d);
        // Abre já no primeiro dia com vaga.
        setDia((atual) =>
          atual && d.some((x) => x.date === atual && x.count)
            ? atual
            : (d.find((x) => x.count)?.date ?? null),
        );
      })
      .catch(() => setDias([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, professionalId, inicio]);

  useEffect(() => {
    setHora(null);
    if (!dia || !serviceId || professionalId === undefined) return setSlots(null);
    setSlots(null);
    chamar<Slots>(`/public/clinics/${clinic.slug}/slots?${qs({ date: dia })}`)
      .then(setSlots)
      .catch(() => setSlots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, serviceId, professionalId, recarga]);

  const horarios = [...new Set(slots?.flatMap((s) => s.times) ?? [])].sort();
  const periodos = [
    ['Manhã', horarios.filter((h) => toMinutes(h) < 12 * 60)],
    ['Tarde', horarios.filter((h) => toMinutes(h) >= 12 * 60 && toMinutes(h) < 18 * 60)],
    ['Noite', horarios.filter((h) => toMinutes(h) >= 18 * 60)],
  ] as const;

  if (!clinic.booking.enabled) {
    return (
      <Cartao>
        <h2 className="text-2xl font-medium">Agendamento pelo site pausado</h2>
        <p className="mt-2 text-nevoa">Fale com a clínica pelo WhatsApp para marcar.</p>
      </Cartao>
    );
  }

  if (feito) return <Feito clinic={clinic} feito={feito} />;

  const passo = !servico ? 1 : professionalId === undefined ? 2 : !hora ? 3 : 4;

  return (
    <Cartao>
      <ol className="space-y-2">
        <Passo
          n={1}
          titulo="Serviço"
          atual={passo === 1}
          valor={servico ? `${servico.name} · ${duracao(servico.durationMinutes)}` : null}
          aoTrocar={() => {
            setServiceId(null);
            setProfessionalId(undefined);
            setDia(null);
          }}
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            {clinic.services.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setServiceId(s.id)}
                className="rounded-2xl bg-folha p-4 text-left ring-1 ring-linha transition hover:ring-2 hover:ring-marca"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{s.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {preco(s.priceCents)}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-nevoa">
                  {duracao(s.durationMinutes)}
                  {s.description ? ` · ${s.description}` : ''}
                </span>
              </button>
            ))}
          </div>
        </Passo>

        <Passo
          n={2}
          titulo="Profissional"
          atual={passo === 2}
          valor={professionalId === undefined ? null : (proEscolhido?.name ?? 'Sem preferência')}
          {...(pros.length > 1
            ? {
                aoTrocar: () => {
                  setProfessionalId(undefined);
                  setDia(null);
                },
              }
            : {})}
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            {pros.length > 1 ? (
              <button
                type="button"
                onClick={() => setProfessionalId(null)}
                className="flex items-center gap-3 rounded-2xl bg-folha p-4 text-left ring-1 ring-linha hover:ring-2 hover:ring-marca"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-porcelana text-nevoa">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.3c1.8.8 3 2.6 3 4.7" />
                  </svg>
                </span>
                <span>
                  <span className="block font-semibold">Sem preferência</span>
                  <span className="text-sm text-nevoa">Mostra mais horários</span>
                </span>
              </button>
            ) : null}
            {pros.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProfessionalId(p.id)}
                className="flex items-center gap-3 rounded-2xl bg-folha p-4 text-left ring-1 ring-linha hover:ring-2 hover:ring-marca"
              >
                <Foto nome={p.name} url={p.photoUrl} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-sm text-nevoa">
                    {p.specialty || p.council}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Passo>

        <Passo
          n={3}
          titulo="Dia e horário"
          atual={passo === 3}
          valor={hora && dia ? `${diaLongo(dia)}, às ${hora}` : null}
          aoTrocar={() => setHora(null)}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold capitalize text-nevoa">{mes(inicio)}</p>
            <div className="flex gap-1">
              <SetaBotao
                rotulo="Dias anteriores"
                disabled={inicio <= hoje}
                aoClicar={() =>
                  setInicio(addDays(inicio, -14) < hoje ? hoje : addDays(inicio, -14))
                }
                direcao="esq"
              />
              <SetaBotao
                rotulo="Próximos dias"
                disabled={addDays(inicio, 14) > addDays(hoje, clinic.booking.horizonDays)}
                aoClicar={() => setInicio(addDays(inicio, 14))}
                direcao="dir"
              />
            </div>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {(
              dias ??
              Array.from({ length: 14 }, (_, i) => ({ date: addDays(inicio, i), count: -1 }))
            ).map((d) => {
              const ativo = d.date === dia;
              const sem = d.count === 0;
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={sem || d.count < 0}
                  aria-pressed={ativo}
                  onClick={() => setDia(d.date)}
                  className={`flex w-14 shrink-0 flex-col items-center rounded-2xl py-2.5 transition ${
                    ativo
                      ? 'bg-marca text-sobre-marca'
                      : sem
                        ? 'text-bruma'
                        : 'bg-folha ring-1 ring-linha hover:ring-marca'
                  } ${d.count < 0 ? 'animate-pulse' : ''}`}
                >
                  <span className="text-[0.7rem] font-semibold uppercase opacity-75">
                    {WEEKDAYS_SHORT[weekdayOf(d.date)]}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {Number(d.date.slice(8))}
                  </span>
                  <span
                    className={`mt-0.5 h-1.5 w-1.5 rounded-full ${d.count > 0 ? (ativo ? 'bg-destaque-na-marca' : 'bg-ok') : 'bg-transparent'}`}
                  />
                </button>
              );
            })}
          </div>
          {dias && !dias.some((d) => d.count) ? (
            <p className="mt-3 rounded-2xl bg-porcelana px-4 py-3 text-sm text-nevoa">
              Sem horários nestes dias. Veja os próximos ou fale com a clínica.
            </p>
          ) : null}
          {dia ? (
            <div className="mt-4 space-y-4">
              {slots === null ? <p className="text-sm text-nevoa">Buscando horários…</p> : null}
              {periodos.map(([nome, lista]) =>
                lista.length ? (
                  <div key={nome}>
                    <p className="mb-2 text-sm font-semibold text-nevoa">{nome}</p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {lista.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setHora(h)}
                          className="h-11 rounded-xl bg-folha text-[0.95rem] font-semibold tabular-nums ring-1 ring-linha hover:bg-marca hover:text-sobre-marca hover:ring-marca"
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          ) : null}
        </Passo>

        <Passo n={4} titulo="Seus dados" atual={passo === 4} valor={null}>
          {servico && hora && dia ? (
            <Dados
              clinic={clinic}
              pedido={{
                serviceId: servico.id,
                ...(professionalId ? { professionalId } : {}),
                date: dia,
                time: hora,
              }}
              aoAgendar={setFeito}
              aoOcupado={() => setRecarga((r) => r + 1)}
            />
          ) : null}
        </Passo>
      </ol>
    </Cartao>
  );
}

function Cartao({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.75rem] bg-folha p-5 shadow-[0_30px_60px_-40px_rgb(15_32_40/0.45)] ring-1 ring-linha sm:p-7">
      {children}
    </div>
  );
}

function Passo({
  n,
  titulo,
  atual,
  valor,
  aoTrocar,
  children,
}: {
  n: number;
  titulo: string;
  atual: boolean;
  valor: string | null;
  aoTrocar?: () => void;
  children: ReactNode;
}) {
  const feito = valor !== null && !atual;
  return (
    <li className={`rounded-2xl ${atual ? 'bg-porcelana/70 p-4 sm:p-5' : 'px-4 py-3 sm:px-5'}`}>
      <div className="flex items-center gap-3">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
            feito
              ? 'bg-ok text-white'
              : atual
                ? 'bg-marca text-sobre-marca'
                : 'bg-porcelana text-bruma'
          }`}
        >
          {feito ? '✓' : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${atual || feito ? '' : 'text-bruma'}`}>
            {titulo}
          </span>
          {feito ? (
            <span className="block truncate text-sm text-nevoa first-letter:uppercase">
              {valor}
            </span>
          ) : null}
        </span>
        {feito && aoTrocar ? (
          <button
            type="button"
            onClick={aoTrocar}
            className="text-sm font-semibold text-marca hover:underline"
          >
            Trocar
          </button>
        ) : null}
      </div>
      {atual ? <div className="entra mt-4">{children}</div> : null}
    </li>
  );
}

function SetaBotao({
  rotulo,
  disabled,
  aoClicar,
  direcao,
}: {
  rotulo: string;
  disabled: boolean;
  aoClicar: () => void;
  direcao: 'esq' | 'dir';
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      disabled={disabled}
      onClick={aoClicar}
      className="grid h-9 w-9 place-items-center rounded-xl text-nevoa hover:bg-porcelana disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={direcao === 'esq' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  );
}

export function Foto({
  nome,
  url,
  tamanho = 'h-12 w-12',
}: {
  nome: string;
  url: string | null;
  tamanho?: string;
}) {
  if (url)
    return (
      <img src={imagem(url)} alt="" className={`${tamanho} shrink-0 rounded-full object-cover`} />
    );
  const ini = nome
    .replace(/^(dra?\.?|dr\.)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={`${tamanho} grid shrink-0 place-items-center rounded-full bg-marca font-semibold text-sobre-marca`}
    >
      {ini}
    </span>
  );
}

const campo =
  'h-12 w-full rounded-xl bg-folha px-4 text-base ring-1 ring-linha placeholder:text-bruma focus:ring-2 focus:ring-marca focus:outline-none';

function Dados({
  clinic,
  pedido,
  aoAgendar,
  aoOcupado,
}: {
  clinic: PublicClinic;
  pedido: { serviceId: string; professionalId?: string; date: string; time: string };
  aoAgendar: (f: { token: string; appointment: ManageView; pix: Pix | null }) => void;
  aoOcupado: () => void;
}) {
  const [d, setD] = useState({ name: '', phone: '', email: '', birthDate: '', notes: '' });
  const [plano, setPlano] = useState({ insurerId: '', cardNumber: '' });
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await chamar<{ token: string; appointment: ManageView; pix: Pix | null }>(
        `/public/clinics/${clinic.slug}/appointments`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...pedido,
            name: d.name,
            phone: d.phone,
            ...(d.email ? { email: d.email } : {}),
            ...(d.birthDate ? { birthDate: d.birthDate } : {}),
            ...(d.notes ? { notes: d.notes } : {}),
            ...(plano.insurerId
              ? { insurance: { insurerId: plano.insurerId, cardNumber: plano.cardNumber.trim() } }
              : {}),
            consent: aceite,
          }),
        },
      );
      aoAgendar(r);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível agendar.');
      if (err instanceof ApiError && err.status === 409) aoOcupado();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3.5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-nevoa">Nome completo</span>
        <input
          className={campo}
          required
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          autoComplete="name"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-nevoa">WhatsApp</span>
        <input
          className={campo}
          required
          inputMode="tel"
          placeholder="(81) 99999-0000"
          value={d.phone}
          onChange={(e) => setD({ ...d, phone: e.target.value })}
          autoComplete="tel"
        />
        <span className="mt-1 block text-xs text-bruma">É por ele que chega a confirmação.</span>
      </label>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-nevoa">E-mail (opcional)</span>
          <input
            className={campo}
            type="email"
            value={d.email}
            onChange={(e) => setD({ ...d, email: e.target.value })}
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-nevoa">
            Nascimento (opcional)
          </span>
          <input
            className={campo}
            type="date"
            value={d.birthDate}
            onChange={(e) => setD({ ...d, birthDate: e.target.value })}
          />
        </label>
      </div>
      {clinic.insurers.length ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-nevoa">
            Como vai ser o atendimento?
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              aria-label="Particular ou convênio"
              value={plano.insurerId}
              onChange={(e) => setPlano({ ...plano, insurerId: e.target.value })}
              className="h-12 w-full rounded-xl bg-folha px-4 ring-1 ring-linha focus:ring-2 focus:ring-marca focus:outline-none"
            >
              <option value="">Particular</option>
              {clinic.insurers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            {plano.insurerId ? (
              <input
                required
                aria-label="Número da carteirinha"
                placeholder="Número da carteirinha"
                maxLength={30}
                value={plano.cardNumber}
                onChange={(e) => setPlano({ ...plano, cardNumber: e.target.value })}
                className="h-12 w-full rounded-xl bg-folha px-4 ring-1 ring-linha focus:ring-2 focus:ring-marca focus:outline-none"
              />
            ) : null}
          </div>
        </fieldset>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-nevoa">
          Quer avisar algo à clínica? (opcional)
        </span>
        <textarea
          rows={2}
          maxLength={500}
          className="w-full rounded-xl bg-folha px-4 py-3 ring-1 ring-linha focus:ring-2 focus:ring-marca focus:outline-none"
          value={d.notes}
          onChange={(e) => setD({ ...d, notes: e.target.value })}
        />
      </label>
      <label className="flex items-start gap-3 rounded-xl bg-porcelana p-3.5 text-sm">
        <input
          type="checkbox"
          checked={aceite}
          onChange={(e) => setAceite(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-marca)]"
        />
        <span className="text-nevoa">
          Autorizo a {clinic.name} a usar meus dados para este agendamento e para me lembrar da
          consulta pelo WhatsApp.{' '}
          <a
            href={`/c/${clinic.slug}/privacidade`}
            target="_blank"
            className="font-semibold text-marca underline"
          >
            Como a clínica cuida dos seus dados
          </a>{' '}
          e{' '}
          <a
            href={`/c/${clinic.slug}/termos`}
            target="_blank"
            className="font-semibold text-marca underline"
          >
            termos do agendamento
          </a>
          .
        </span>
      </label>
      {erro ? (
        <p
          role="alert"
          className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta"
        >
          {erro}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!aceite || enviando}
        className="h-13 w-full rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque transition hover:bg-destaque-forte disabled:opacity-50"
      >
        {enviando ? 'Agendando…' : 'Confirmar agendamento'}
      </button>
    </form>
  );
}

function Feito({
  clinic,
  feito,
}: {
  clinic: PublicClinic;
  feito: { token: string; appointment: ManageView; pix: Pix | null };
}) {
  const [pago, setPago] = useState(false);
  const a = feito.appointment;
  const sinal = a.deposit?.status === 'open' && !pago;
  const tz = a.unit.timezone;
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.startsAt));
  const dia = localClock(new Date(a.startsAt), tz).ymd;
  const link = `${typeof window === 'undefined' ? '' : window.location.origin}/a/${feito.token}`;
  return (
    <Cartao>
      <div className="entra text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok-fundo text-2xl text-ok">
          ✓
        </span>
        <h2 className="mt-4 text-[1.9rem] leading-tight font-medium">
          Consulta marcada, {a.patientFirstName}!
        </h2>
        <p className="mt-2 text-nevoa">
          {sinal
            ? 'Falta só o sinal no Pix para garantir o horário.'
            : pago
              ? 'Sinal recebido. Horário garantido.'
              : 'A clínica vai te mandar a confirmação pelo WhatsApp.'}
        </p>
      </div>
      {sinal ? (
        <div className="mt-6">
          <PixSinal token={feito.token} inicial={feito.pix} aoPagar={() => setPago(true)} />
        </div>
      ) : null}
      <dl className="mt-6 grid gap-4 rounded-2xl bg-porcelana p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-nevoa">Quando</dt>
          <dd className="mt-0.5 font-semibold first-letter:uppercase">
            {diaLongo(dia)}, às {hora}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-nevoa">O quê</dt>
          <dd className="mt-0.5 font-semibold">
            {a.serviceName} com {a.professionalName}
          </dd>
        </div>
        {a.unit.address ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-nevoa">Onde</dt>
            <dd className="mt-0.5">{a.unit.address}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-5 text-sm text-nevoa">
        Precisa desmarcar? Use este link, que é só seu:{' '}
        <a href={link} className="font-semibold break-all text-marca underline">
          {link.replace(/^https?:\/\//, '')}
        </a>
      </p>
      {clinic.whatsapp ? (
        <p className="mt-2 text-sm text-nevoa">Dúvidas, fale com a clínica no WhatsApp.</p>
      ) : null}
    </Cartao>
  );
}
