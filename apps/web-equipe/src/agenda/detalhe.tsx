import { useEffect, useState } from 'react';
import {
  MESSAGE_LABELS,
  STATUS_LABELS,
  whatsappLink,
  type AppointmentStatus,
} from '@tagtech/domain';
import {
  api,
  ApiError,
  linkPaciente,
  type Appointment,
  type HistoryEvent,
  type SentMessage,
  type Patient,
  type WaitlistEntry,
} from '../api';
import { mensagem, usePainel } from '../contexto';
import {
  dataHora,
  diaLocal,
  diaLongo,
  dinheiro,
  hora,
  idade,
  instante,
  telefone,
} from '../formato';
import { Botao, Campo, Entrada, Gaveta, Icone, Seletor, STATUS_ESTILO, Texto } from '../ui';

/** O próximo passo de cada estado, na ordem em que a recepção costuma usar. */
const ACOES: Partial<
  Record<
    AppointmentStatus,
    Array<{
      para: AppointmentStatus;
      rotulo: string;
      variante: 'principal' | 'contorno' | 'perigo';
    }>
  >
> = {
  scheduled: [
    { para: 'confirmed', rotulo: 'Confirmar presença', variante: 'principal' },
    { para: 'arrived', rotulo: 'Paciente chegou', variante: 'contorno' },
    { para: 'no_show', rotulo: 'Faltou', variante: 'perigo' },
  ],
  confirmed: [
    { para: 'arrived', rotulo: 'Paciente chegou', variante: 'principal' },
    { para: 'no_show', rotulo: 'Faltou', variante: 'perigo' },
  ],
  arrived: [
    { para: 'in_progress', rotulo: 'Iniciar atendimento', variante: 'principal' },
    { para: 'done', rotulo: 'Finalizar', variante: 'contorno' },
  ],
  in_progress: [{ para: 'done', rotulo: 'Finalizar atendimento', variante: 'principal' }],
  done: [{ para: 'in_progress', rotulo: 'Reabrir atendimento', variante: 'contorno' }],
  no_show: [{ para: 'scheduled', rotulo: 'Desfazer falta', variante: 'contorno' }],
};

export function Detalhe({
  consulta,
  aoFechar,
  aoMudar,
}: {
  consulta: Appointment | null;
  aoFechar: () => void;
  aoMudar: (a: Appointment) => void;
}) {
  return (
    <Gaveta
      aberta={consulta !== null}
      aoFechar={aoFechar}
      titulo={consulta?.patient.name ?? ''}
      subtitulo={
        consulta ? `${consulta.service.name} com ${consulta.professional.name}` : undefined
      }
    >
      {consulta ? <Conteudo key={consulta.id} a={consulta} aoMudar={aoMudar} /> : null}
    </Gaveta>
  );
}

function Conteudo({ a, aoMudar }: { a: Appointment; aoMudar: (a: Appointment) => void }) {
  const { clinic, professionals, avisar } = usePainel();
  const [ficha, setFicha] = useState<Patient | null>(null);
  const [historico, setHistorico] = useState<HistoryEvent[]>([]);
  const [mensagens, setMensagens] = useState<SentMessage[]>([]);
  const [modo, setModo] = useState<'nada' | 'remarcar' | 'cancelar'>('nada');
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState<WaitlistEntry[] | null>(null);
  const [notas, setNotas] = useState(a.notes);

  useEffect(() => {
    api
      .history(a.id)
      .then(setHistorico)
      .catch(() => {});
    // A ficha só é aberta se houver alerta: abrir fica registrado (LGPD).
    if (a.patient.hasAlerts)
      api
        .patient(a.patient.id)
        .then(setFicha)
        .catch(() => {});
    if (a.status === 'cancelled')
      api
        .waitlistMatches(a.id)
        .then(setEspera)
        .catch(() => {});
  }, [a]);

  async function status(para: AppointmentStatus, reason?: string) {
    setOcupado(true);
    try {
      const nova = await api.setStatus(a.id, para, reason);
      avisar(`${STATUS_LABELS[para]}`);
      aoMudar(nova);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setOcupado(false);
    }
  }

  /** Abre o WhatsApp com a mensagem pronta e o link para confirmar ou desmarcar. */
  async function pedirConfirmacao() {
    if (!a.patient.phone) return avisar('Este paciente não tem WhatsApp cadastrado.', 'erro');
    try {
      const { token } = await api.manageLink(a.id);
      const primeiro = a.patient.name.split(' ')[0];
      const texto = `Olá, ${primeiro}! Aqui é da ${clinic.name}. Sua consulta de ${a.service.name} está marcada para ${diaLongo(diaLocal(a.startsAt))} às ${hora(a.startsAt)}. Confirme ou desmarque por aqui: ${linkPaciente(token)}`;
      window.open(whatsappLink(a.patient.phone, texto), '_blank', 'noopener');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const acoes = ACOES[a.status] ?? [];
  const podeMexer = a.status === 'scheduled' || a.status === 'confirmed';

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-center gap-2.5">
        <span className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${STATUS_ESTILO[a.status]}`}>
          {STATUS_LABELS[a.status]}
        </span>
        {a.source === 'online' ? (
          <span className="rounded-lg bg-trilho px-2.5 py-1 text-sm font-medium text-nevoa">
            Agendado pelo site
          </span>
        ) : null}
        {a.cancelReason ? (
          <span className="text-sm text-nevoa">Motivo: {a.cancelReason}</span>
        ) : null}
      </section>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-porcelana p-5">
        <Item rotulo="Quando" valor={`${dataHora(a.startsAt)} – ${hora(a.endsAt)}`} largo />
        <Item rotulo="WhatsApp" valor={telefone(a.patient.phone) || '—'} />
        <Item rotulo="Valor" valor={dinheiro(a.priceCents)} />
        {a.patient.birthDate ? (
          <Item rotulo="Idade" valor={idade(a.patient.birthDate) ?? ''} />
        ) : null}
      </dl>

      {ficha && (ficha.allergies || ficha.medications) ? (
        <section className="rounded-2xl bg-ambar-fundo p-4 text-ambar-tinta">
          <p className="flex items-center gap-2 font-semibold">
            <Icone nome="alerta" className="h-4 w-4" /> Atenção na ficha
          </p>
          {ficha.allergies ? <p className="mt-1.5 text-sm">Alergias: {ficha.allergies}</p> : null}
          {ficha.medications ? (
            <p className="mt-1 text-sm">Medicamentos: {ficha.medications}</p>
          ) : null}
        </section>
      ) : null}

      {acoes.length ? (
        <section className="flex flex-wrap gap-2.5">
          {acoes.map((x) => (
            <Botao
              key={x.para}
              variante={x.variante}
              disabled={ocupado}
              onClick={() => status(x.para)}
            >
              {x.rotulo}
            </Botao>
          ))}
        </section>
      ) : null}

      {podeMexer ? (
        <section className="space-y-2.5">
          <Botao className="w-full justify-start" onClick={pedirConfirmacao}>
            <Icone nome="whatsapp" className="h-4 w-4 text-ok" />
            Pedir confirmação no WhatsApp
          </Botao>
          <div className="grid grid-cols-2 gap-2.5">
            <Botao onClick={() => setModo(modo === 'remarcar' ? 'nada' : 'remarcar')}>
              Remarcar
            </Botao>
            <Botao
              variante="perigo"
              onClick={() => setModo(modo === 'cancelar' ? 'nada' : 'cancelar')}
            >
              Cancelar consulta
            </Botao>
          </div>
          {modo === 'remarcar' ? (
            <Remarcar
              a={a}
              profissionais={professionals.filter((p) => p.active)}
              aoMudar={aoMudar}
            />
          ) : null}
          {modo === 'cancelar' ? (
            <Cancelar aoCancelar={(motivo) => status('cancelled', motivo)} />
          ) : null}
        </section>
      ) : null}

      {espera?.length ? (
        <section className="rounded-2xl ring-1 ring-ambar/50">
          <p className="border-b border-linha px-4 py-3 font-semibold">
            {espera.length === 1 ? '1 pessoa' : `${espera.length} pessoas`} da lista de espera cabem
            neste horário
          </p>
          <ul className="divide-y divide-linha">
            {espera.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.patient.name}</span>
                  <span className="text-sm text-nevoa">{telefone(w.patient.phone)}</span>
                </span>
                {w.patient.phone ? (
                  <a
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ok-fundo px-3 text-sm font-semibold text-ok"
                    target="_blank"
                    rel="noreferrer"
                    href={whatsappLink(
                      w.patient.phone,
                      `Olá, ${w.patient.name.split(' ')[0]}! Abriu um horário de ${w.serviceName} na ${clinic.name}: ${diaLongo(diaLocal(a.startsAt))} às ${hora(a.startsAt)}. Quer ficar com ele? Responda por aqui.`,
                    )}
                    onClick={() => void api.setWaitlistStatus(w.id, 'offered')}
                  >
                    <Icone nome="whatsapp" className="h-4 w-4" /> Oferecer
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <Campo rotulo="Observação">
          <Texto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
        {notas !== a.notes ? (
          <Botao
            tamanho="pequeno"
            className="mt-2"
            onClick={async () => {
              try {
                aoMudar(await api.updateAppointment(a.id, { notes: notas }));
                avisar('Observação salva');
              } catch (e) {
                avisar(mensagem(e), 'erro');
              }
            }}
          >
            Salvar observação
          </Botao>
        ) : null}
      </section>

      {mensagens.length ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-nevoa">WhatsApp automático</h3>
          <ul className="space-y-2">
            {mensagens.map((m, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                <Icone
                  nome={m.status === 'failed' ? 'alerta' : 'whatsapp'}
                  className={`h-4 w-4 ${m.status === 'failed' ? 'text-alerta' : 'text-ok'}`}
                />
                <span className="font-medium">{MESSAGE_LABELS[m.event]}</span>
                <span className="text-nevoa">
                  ·{' '}
                  {m.status === 'failed'
                    ? 'não enviada'
                    : m.status === 'sent'
                      ? 'enviada'
                      : 'enviando'}{' '}
                  · {dataHora(m.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {historico.length ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-nevoa">Histórico</h3>
          <ol className="space-y-2.5 border-l border-linha pl-4">
            {historico.map((h, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-linha" />
                <span className="font-medium">
                  {h.reason === 'Remarcada' ? 'Remarcada' : STATUS_LABELS[h.to]}
                </span>
                <span className="text-nevoa">
                  {' '}
                  · {h.actor} · {dataHora(h.at)}
                </span>
                {h.fromStartsAt ? (
                  <span className="block text-nevoa">Antes: {dataHora(h.fromStartsAt)}</span>
                ) : null}
                {h.reason && h.reason !== 'Remarcada' ? (
                  <span className="block text-nevoa">{h.reason}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Item({ rotulo, valor, largo }: { rotulo: string; valor: string; largo?: boolean }) {
  return (
    <div className={largo ? 'col-span-2' : ''}>
      <dt className="text-xs font-semibold text-nevoa">{rotulo}</dt>
      <dd className="mt-0.5 font-medium first-letter:uppercase">{valor}</dd>
    </div>
  );
}

function Remarcar({
  a,
  profissionais,
  aoMudar,
}: {
  a: Appointment;
  profissionais: Array<{ id: string; name: string }>;
  aoMudar: (a: Appointment) => void;
}) {
  const { avisar } = usePainel();
  const [dia, setDia] = useState(diaLocal(a.startsAt));
  const [h, setH] = useState(hora(a.startsAt));
  const [pro, setPro] = useState(a.professional.id);
  const [encaixe, setEncaixe] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <div className="space-y-3 rounded-2xl bg-porcelana p-4">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Nova data">
          <Entrada type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </Campo>
        <Campo rotulo="Hora">
          <Entrada type="time" step={300} value={h} onChange={(e) => setH(e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="Profissional">
        <Seletor value={pro} onChange={(e) => setPro(e.target.value)}>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Seletor>
      </Campo>
      {encaixe ? (
        <p className="text-sm text-ambar-tinta">Vai como encaixe, fora do turno ou num bloqueio.</p>
      ) : null}
      {erro ? <p className="text-sm font-medium text-alerta">{erro}</p> : null}
      <Botao
        variante="principal"
        className="w-full"
        onClick={async () => {
          setErro(null);
          try {
            const nova = await api.updateAppointment(a.id, {
              startsAt: instante(dia, h),
              professionalId: pro,
              ...(encaixe ? { allowOutsideHours: true } : {}),
            });
            avisar('Consulta remarcada');
            aoMudar(nova);
          } catch (e) {
            if (e instanceof ApiError && (e.reason === 'outside_hours' || e.reason === 'time_off'))
              setEncaixe(true);
            setErro(mensagem(e));
          }
        }}
      >
        {encaixe ? 'Remarcar como encaixe' : 'Remarcar'}
      </Botao>
    </div>
  );
}

function Cancelar({ aoCancelar }: { aoCancelar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const sugestoes = ['Paciente desmarcou', 'Profissional indisponível', 'Remarcar depois'];
  return (
    <div className="space-y-3 rounded-2xl bg-alerta-fundo/60 p-4">
      <div className="flex flex-wrap gap-2">
        {sugestoes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setMotivo(s)}
            className="rounded-lg bg-folha px-2.5 py-1.5 text-sm ring-1 ring-linha hover:ring-alerta/40"
          >
            {s}
          </button>
        ))}
      </div>
      <Entrada
        placeholder="Motivo do cancelamento"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <Botao
        variante="perigo"
        className="w-full"
        disabled={motivo.trim().length < 3}
        onClick={() => aoCancelar(motivo.trim())}
      >
        Confirmar cancelamento
      </Botao>
    </div>
  );
}
