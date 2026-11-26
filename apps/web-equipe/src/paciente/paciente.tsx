import { useEffect, useState } from 'react';
import { STATUS_LABELS } from '@tagtech/domain';
import { api, type Patient } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataHora, dinheiro, idade, telefone } from '../formato';
import { Ficha } from '../pacientes';
import { Avatar, Botao, Gaveta, Icone, STATUS_ESTILO } from '../ui';
import { Documentos } from './documentos';
import { Fotos } from './fotos';
import { Odontograma } from './odontograma';
import { Orcamentos } from './orcamentos';
import { Pacotes } from './pacotes';
import { Convenio } from './convenio';
import { Prontuario } from './prontuario';

type Aba =
  | 'prontuario'
  | 'odontograma'
  | 'fotos'
  | 'documentos'
  | 'orcamentos'
  | 'pacotes'
  | 'convenio'
  | 'consultas';

/** Página do paciente: dados, prontuário, odontograma, fotos e consultas. */
export function PacienteTela({ id }: { id: string }) {
  const { vinculo, professionals, avisar, clinic, gerencia, tem } = usePainel();
  const clinico = vinculo.role !== 'reception';
  const temOdonto = professionals.some((p) => p.recordKind === 'odonto');
  const abas: Array<[Aba, string]> = [
    ...(clinico ? ([['prontuario', 'Prontuário']] as Array<[Aba, string]>) : []),
    ...(clinico && temOdonto ? ([['odontograma', 'Odontograma']] as Array<[Aba, string]>) : []),
    ...(clinico ? ([['fotos', 'Fotos']] as Array<[Aba, string]>) : []),
    ...(clinico ? ([['documentos', 'Documentos']] as Array<[Aba, string]>) : []),
    ['orcamentos', 'Orçamentos'],
    ...(tem('packages') ? ([['pacotes', 'Pacotes']] as Array<[Aba, string]>) : []),
    ...(clinic.insuranceEnabled && tem('insurance')
      ? ([['convenio', 'Convênio']] as Array<[Aba, string]>)
      : []),
    ['consultas', 'Consultas'],
  ];
  const [aba, setAba] = useState<Aba>(abas[0]![0]);
  const [p, setP] = useState<Patient | null>(null);
  const [editando, setEditando] = useState(false);
  const [privacidade, setPrivacidade] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

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
          <h1 className="text-[2.2rem] leading-none font-bold">{p.name}</h1>
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
        <div className="flex gap-2">
          {gerencia ? (
            <Botao variante="discreto" onClick={() => setPrivacidade(true)}>
              Privacidade
            </Botao>
          ) : null}
          <Botao onClick={() => setEditando(true)}>
            <Icone nome="editar" className="h-4 w-4" /> Dados do paciente
          </Botao>
        </div>
      </header>

      {p.contactErasedAt ? (
        <p className="mb-6 rounded-2xl bg-trilho px-4 py-3 text-sm text-nevoa">
          O paciente pediu a exclusão dos dados em {dataHora(p.contactErasedAt)}. O contato foi
          apagado e ele não recebe mensagens; o prontuário fica guardado pelo prazo legal.
        </p>
      ) : null}

      <Gaveta
        aberta={privacidade}
        aoFechar={() => setPrivacidade(false)}
        titulo="Privacidade do paciente"
        subtitulo="Pedidos do titular pela LGPD. Tudo fica no registro de acesso."
      >
        <div className="space-y-6">
          <section className="rounded-2xl bg-porcelana p-5 ring-1 ring-linha">
            <h3 className="font-semibold">Cópia dos dados</h3>
            <p className="mt-1 text-sm text-nevoa">
              Arquivo com cadastro, consultas, prontuário, orçamentos, financeiro e convênio. As
              fotos clínicas vão à parte.
            </p>
            <a
              href={api.exportPatientUrl(p.id)}
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-petroleo px-4 font-semibold text-white"
            >
              <Icone nome="upload" className="h-4 w-4 rotate-180" /> Baixar dados
            </a>
          </section>
          <section className="rounded-2xl p-5 ring-1 ring-alerta/40">
            <h3 className="font-semibold text-alerta">Pedido de exclusão</h3>
            <p className="mt-1 text-sm text-nevoa">
              Sem histórico clínico ou financeiro, o cadastro é apagado de vez. Com histórico, o
              contato é apagado, as consultas futuras são canceladas, a foto sai do site e o
              prontuário fica guardado pelo prazo legal (20 anos).
            </p>
            {confirmando ? (
              <div className="mt-3 flex gap-2">
                <Botao onClick={() => setConfirmando(false)}>Voltar</Botao>
                <Botao
                  variante="perigo"
                  onClick={async () => {
                    try {
                      const r = await api.erasePatient(p.id);
                      setPrivacidade(false);
                      setConfirmando(false);
                      if (r.mode === 'deleted') {
                        avisar('Cadastro apagado');
                        location.hash = '#pacientes';
                      } else {
                        avisar('Contato apagado; prontuário guardado');
                        void carregar();
                      }
                    } catch (e) {
                      avisar(mensagem(e), 'erro');
                    }
                  }}
                >
                  Confirmar exclusão
                </Botao>
              </div>
            ) : (
              <Botao className="mt-3" variante="perigo" onClick={() => setConfirmando(true)}>
                Atender pedido de exclusão
              </Botao>
            )}
          </section>
        </div>
      </Gaveta>

      <Resumo p={p} />

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

      <nav
        aria-label="Ficha"
        className="rolagem-fina mb-7 flex gap-1 overflow-x-auto border-b border-linha"
      >
        {abas.map(([k, nome]) => (
          <button
            key={k}
            type="button"
            aria-current={aba === k ? 'page' : undefined}
            onClick={() => setAba(k)}
            className={`-mb-px shrink-0 border-b-2 px-4 pb-3 text-[0.95rem] font-semibold transition-colors ${
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
      {aba === 'documentos' ? <Documentos patientId={p.id} /> : null}
      {aba === 'convenio' ? <Convenio patientId={p.id} /> : null}
      {aba === 'pacotes' ? <Pacotes patientId={p.id} /> : null}
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

/** Faixa com o essencial antes de abrir qualquer aba: próxima, última, histórico e saldo. */
function Resumo({ p }: { p: Patient }) {
  const { vinculo } = usePainel();
  const [aberto, setAberto] = useState<number | null>(null);
  useEffect(() => {
    if (vinculo.role === 'professional') return;
    api
      .charges({ patientId: p.id, status: 'open' })
      .then((l) => setAberto(l.reduce((s, c) => s + c.amountCents, 0)))
      .catch(() => setAberto(null));
  }, [p.id, vinculo.role]);
  const agora = Date.now();
  const lista = p.appointments ?? [];
  const proxima = lista
    .filter(
      (a) =>
        new Date(a.startsAt).getTime() >= agora && ['scheduled', 'confirmed'].includes(a.status),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const ultima = lista
    .filter((a) => a.status === 'done')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const feitas = lista.filter((a) => a.status === 'done').length;
  const faltas = lista.filter((a) => a.status === 'no_show').length;
  const itens: Array<{ rotulo: string; valor: string; detalhe?: string; tom?: string }> = [
    {
      rotulo: 'Próxima consulta',
      valor: proxima ? dataHora(proxima.startsAt) : 'Nada marcado',
      ...(proxima ? { detalhe: `${proxima.serviceName} · ${proxima.professionalName}` } : {}),
      ...(proxima ? {} : { tom: 'text-nevoa' }),
    },
    {
      rotulo: 'Última visita',
      valor: ultima ? dataHora(ultima.startsAt) : 'Primeira vez',
      ...(ultima ? { detalhe: ultima.serviceName } : {}),
    },
    {
      rotulo: 'Histórico',
      valor: `${feitas} ${feitas === 1 ? 'consulta' : 'consultas'}`,
      detalhe: faltas ? `${faltas} ${faltas === 1 ? 'falta' : 'faltas'}` : 'Nenhuma falta',
      ...(faltas >= 2 ? { tom: 'text-alerta' } : {}),
    },
    ...(aberto !== null
      ? [
          {
            rotulo: 'Em aberto',
            valor: aberto ? dinheiro(aberto) : 'Nada a receber',
            ...(aberto ? { tom: 'text-ambar-tinta' } : { tom: 'text-nevoa' }),
          },
        ]
      : []),
  ];
  return (
    <dl className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl bg-folha ring-1 ring-linha lg:grid-cols-4">
      {itens.map((i, n) => (
        <div
          key={i.rotulo}
          className={`px-5 py-4 ${n % 2 ? 'border-l border-linha' : ''} ${n >= 2 ? 'border-t border-linha lg:border-t-0' : ''} ${n === 2 ? 'lg:border-l' : ''}`}
        >
          <dt className="text-[0.8rem] font-semibold text-bruma">{i.rotulo}</dt>
          <dd className={`mt-1 font-semibold tabular-nums ${i.tom ?? ''}`}>{i.valor}</dd>
          {i.detalhe ? <dd className="mt-0.5 truncate text-sm text-nevoa">{i.detalhe}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
