import { useEffect, useState } from 'react';
import { STATUS_LABELS } from '@tagtech/domain';
import { api, type Patient } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataHora, idade, telefone } from '../formato';
import { Ficha } from '../pacientes';
import { Avatar, Botao, Icone, STATUS_ESTILO } from '../ui';
import { Fotos } from './fotos';
import { Odontograma } from './odontograma';
import { Orcamentos } from './orcamentos';
import { Prontuario } from './prontuario';

type Aba = 'prontuario' | 'odontograma' | 'fotos' | 'orcamentos' | 'consultas';

/** Página do paciente: dados, prontuário, odontograma, fotos e consultas. */
export function PacienteTela({ id }: { id: string }) {
  const { vinculo, professionals, avisar } = usePainel();
  const clinico = vinculo.role !== 'reception';
  const temOdonto = professionals.some((p) => p.recordKind === 'odonto');
  const abas: Array<[Aba, string]> = [
    ...(clinico ? ([['prontuario', 'Prontuário']] as Array<[Aba, string]>) : []),
    ...(clinico && temOdonto ? ([['odontograma', 'Odontograma']] as Array<[Aba, string]>) : []),
    ...(clinico ? ([['fotos', 'Fotos']] as Array<[Aba, string]>) : []),
    ['orcamentos', 'Orçamentos'],
    ['consultas', 'Consultas'],
  ];
  const [aba, setAba] = useState<Aba>(abas[0]![0]);
  const [p, setP] = useState<Patient | null>(null);
  const [editando, setEditando] = useState(false);

  const carregar = () =>
    api
      .patient(id)
      .then(setP)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!p) return <p className="text-nevoa">Carregando…</p>;

  return (
    <>
      <a
        href="#pacientes"
        className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-nevoa hover:text-tinta"
      >
        <Icone nome="esquerda" className="h-4 w-4" /> Pacientes
      </a>
      <header className="mb-6 flex flex-wrap items-center gap-5">
        <Avatar nome={p.name} cor="#56676f" tamanho="h-16 w-16 text-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[2.2rem] leading-none font-medium">{p.name}</h1>
          <p className="mt-2 text-nevoa">
            {[
              idade(p.birthDate),
              telefone(p.phone),
              p.cpf ? `CPF ${p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sem dados de contato'}
          </p>
        </div>
        <Botao onClick={() => setEditando(true)}>
          <Icone nome="editar" className="h-4 w-4" /> Dados do paciente
        </Botao>
      </header>

      {p.allergies || p.medications ? (
        <div className="mb-6 flex flex-wrap gap-2.5">
          {p.allergies ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-ambar-fundo px-3 py-2 text-sm font-semibold text-ambar-tinta">
              <Icone nome="alerta" className="h-4 w-4" /> Alergia: {p.allergies}
            </span>
          ) : null}
          {p.medications ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-ambar-fundo px-3 py-2 text-sm font-semibold text-ambar-tinta">
              Medicamentos: {p.medications}
            </span>
          ) : null}
        </div>
      ) : null}

      <nav aria-label="Ficha" className="mb-7 flex gap-1 border-b border-linha">
        {abas.map(([k, nome]) => (
          <button
            key={k}
            type="button"
            aria-current={aba === k ? 'page' : undefined}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-4 pb-3 text-[0.95rem] font-semibold transition-colors ${
              aba === k
                ? 'border-petroleo text-petroleo'
                : 'border-transparent text-nevoa hover:text-tinta'
            }`}
          >
            {nome}
          </button>
        ))}
      </nav>

      {aba === 'prontuario' ? <Prontuario patientId={p.id} /> : null}
      {aba === 'odontograma' ? <Odontograma patientId={p.id} /> : null}
      {aba === 'fotos' ? <Fotos patientId={p.id} /> : null}
      {aba === 'orcamentos' ? <Orcamentos patientId={p.id} telefone={p.phone} /> : null}
      {aba === 'consultas' ? (
        p.appointments?.length ? (
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {p.appointments.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.serviceName}</span>
                  <span className="text-sm text-nevoa">
                    {dataHora(c.startsAt)} · {c.professionalName}
                  </span>
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_ESTILO[c.status]}`}
                >
                  {STATUS_LABELS[c.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-nevoa">Nenhuma consulta ainda.</p>
        )
      ) : null}

      <Ficha
        id={editando ? p.id : null}
        aoFechar={() => setEditando(false)}
        aoSalvar={() => void carregar()}
      />
    </>
  );
}
