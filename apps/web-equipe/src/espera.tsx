import { useCallback, useEffect, useState } from 'react';
import { addDays, whatsappLink } from '@tagtech/domain';
import { api, type PatientSummary, type WaitlistEntry } from './api';
import { BuscaPaciente } from './agenda/novo';
import { mensagem, usePainel } from './contexto';
import { dataCurta, hoje, telefone } from './formato';
import { Botao, Cabecalho, Campo, Entrada, Gaveta, Icone, Seletor, Texto, Vazio } from './ui';

const PERIODOS: Record<WaitlistEntry['period'], string> = {
  any: 'Qualquer horário',
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
};

export function EsperaTela() {
  const { avisar, professionals, clinic } = usePainel();
  const [lista, setLista] = useState<WaitlistEntry[] | null>(null);
  const [novo, setNovo] = useState(false);
  const carregar = useCallback(
    () =>
      api
        .waitlist()
        .then(setLista)
        .catch((e) => avisar(mensagem(e), 'erro')),
    [avisar],
  );
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mudar = async (id: string, status: WaitlistEntry['status']) => {
    try {
      await api.setWaitlistStatus(id, status);
      void carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  };

  return (
    <>
      <Cabecalho
        titulo="Lista de espera"
        descricao="Quem quer um horário mais cedo. Quando uma consulta é cancelada, a agenda mostra quem da lista cabe no horário que abriu."
        acoes={
          <Botao variante="principal" onClick={() => setNovo(true)}>
            <Icone nome="mais" className="h-4 w-4" /> Adicionar à lista
          </Botao>
        }
      />
      {lista === null ? null : lista.length === 0 ? (
        <Vazio
          titulo="Lista vazia"
          texto="Quando um paciente pedir um horário que não tem, coloque-o aqui. Ele é lembrado assim que alguém desmarcar."
        />
      ) : (
        <ul className="space-y-3">
          {lista.map((w) => {
            const pro = professionals.find((p) => p.id === w.professionalId);
            return (
              <li
                key={w.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl bg-folha px-5 py-4 ring-1 ring-linha"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {w.patient.name}
                    {w.status === 'offered' ? (
                      <span className="ml-2 rounded-md bg-ambar-fundo px-2 py-0.5 text-xs text-ambar-tinta">
                        Horário oferecido
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-nevoa">
                    {w.serviceName}
                    {pro ? ` com ${pro.name}` : ''} · {PERIODOS[w.period].toLowerCase()} · de{' '}
                    {dataCurta(w.fromDate)} a {dataCurta(w.toDate)}
                  </p>
                  {w.notes ? <p className="mt-1 text-sm text-nevoa">{w.notes}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {w.patient.phone ? (
                    <a
                      href={whatsappLink(
                        w.patient.phone,
                        `Olá, ${w.patient.name.split(' ')[0]}! Aqui é da ${clinic.name}, sobre o horário de ${w.serviceName} que você pediu.`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ok-fundo px-3 text-sm font-semibold text-ok"
                    >
                      <Icone nome="whatsapp" className="h-4 w-4" /> {telefone(w.patient.phone)}
                    </a>
                  ) : null}
                  <Botao tamanho="pequeno" onClick={() => mudar(w.id, 'booked')}>
                    Já agendado
                  </Botao>
                  <Botao
                    tamanho="pequeno"
                    variante="discreto"
                    onClick={() => mudar(w.id, 'cancelled')}
                  >
                    Tirar da lista
                  </Botao>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Gaveta aberta={novo} aoFechar={() => setNovo(false)} titulo="Adicionar à lista de espera">
        {novo ? (
          <Formulario
            aoSalvar={() => {
              setNovo(false);
              void carregar();
            }}
          />
        ) : null}
      </Gaveta>
    </>
  );
}

function Formulario({ aoSalvar }: { aoSalvar: () => void }) {
  const { services, professionals, avisar } = usePainel();
  const [paciente, setPaciente] = useState<PatientSummary | null>(null);
  const [serviceId, setServiceId] = useState(services.find((s) => s.active)?.id ?? '');
  const [professionalId, setProfessionalId] = useState('');
  const [de, setDe] = useState(hoje());
  const [ate, setAte] = useState(addDays(hoje(), 14));
  const [periodo, setPeriodo] = useState<WaitlistEntry['period']>('any');
  const [notas, setNotas] = useState('');

  return (
    <div className="space-y-5">
      {paciente ? (
        <div className="flex items-center justify-between rounded-2xl bg-porcelana p-4">
          <span className="font-semibold">{paciente.name}</span>
          <Botao tamanho="pequeno" variante="discreto" onClick={() => setPaciente(null)}>
            Trocar
          </Botao>
        </div>
      ) : (
        <BuscaPaciente aoEscolher={setPaciente} />
      )}
      <Campo rotulo="Serviço">
        <Seletor value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services
            .filter((s) => s.active)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Seletor>
      </Campo>
      <Campo rotulo="Profissional">
        <Seletor value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
          <option value="">Qualquer um</option>
          {professionals
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Seletor>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="A partir de">
          <Entrada type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Campo>
        <Campo rotulo="Até">
          <Entrada type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="Período">
        <Seletor
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as WaitlistEntry['period'])}
        >
          {Object.entries(PERIODOS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Seletor>
      </Campo>
      <Campo rotulo="Observação">
        <Texto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <Botao
        variante="principal"
        tamanho="grande"
        className="w-full"
        disabled={!paciente || !serviceId}
        onClick={async () => {
          try {
            await api.addToWaitlist({
              patientId: paciente!.id,
              serviceId,
              professionalId: professionalId || null,
              fromDate: de,
              toDate: ate,
              period: periodo,
              notes: notas.trim(),
            });
            avisar('Adicionado à lista de espera');
            aoSalvar();
          } catch (e) {
            avisar(mensagem(e), 'erro');
          }
        }}
      >
        Adicionar
      </Botao>
    </div>
  );
}
