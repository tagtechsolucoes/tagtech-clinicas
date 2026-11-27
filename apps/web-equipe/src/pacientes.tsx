import { useEffect, useState } from 'react';
import { STATUS_LABELS, formatBRL } from '@tagtech/domain';
import {
  api,
  type Patient,
  type PatientFilter,
  type PatientRow,
  type PatientsOverview,
} from './api';
import { mensagem, usePainel } from './contexto';
import { dataHora, getFuso, idade, telefone } from './formato';
import {
  Avatar,
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  Gaveta,
  Icone,
  STATUS_ESTILO,
  Texto,
  Vazio,
} from './ui';

const FILTROS: Array<{ id: PatientFilter; nome: string }> = [
  { id: 'all', nome: 'Todos' },
  { id: 'recall', nome: 'Retorno vencido' },
  { id: 'birthdays', nome: 'Aniversariantes' },
  { id: 'new', nome: 'Novos' },
  { id: 'site', nome: 'Vieram pelo site' },
];

const SITUACAO: Record<PatientRow['situation'], { nome: string; estilo: string }> = {
  here: { nome: 'Na clínica', estilo: 'bg-petroleo text-white' },
  scheduled: { nome: 'Agendado', estilo: 'bg-azul-fundo text-azul' },
  ok: { nome: 'Em dia', estilo: 'bg-ok-fundo text-ok' },
  recall: { nome: 'Retorno vencido', estilo: 'bg-ambar-fundo text-ambar-tinta' },
  new: { nome: 'Sem consulta', estilo: 'bg-trilho text-nevoa' },
};

const POR_PAGINA = 50;
const data = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: getFuso(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: getFuso(),
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace('.', '');

export function PacientesTela() {
  const { avisar, gerencia } = usePainel();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<PatientFilter>('all');
  const [dados, setDados] = useState<PatientsOverview | null>(null);
  const [mais, setMais] = useState(false);
  const [aberto, setAberto] = useState<string | 'novo' | null>(null);
  const [importar, setImportar] = useState(false);

  const buscar = () =>
    api
      .patientsOverview({ q, filter: filtro, limit: POR_PAGINA, offset: 0 })
      .then(setDados)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    const t = setTimeout(buscar, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filtro]);

  async function carregarMais() {
    if (!dados) return;
    setMais(true);
    try {
      const r = await api.patientsOverview({
        q,
        filter: filtro,
        limit: POR_PAGINA,
        offset: dados.rows.length,
      });
      setDados({ ...r, rows: [...dados.rows, ...r.rows] });
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setMais(false);
    }
  }

  const st = dados?.stats;
  const lista = dados?.rows ?? null;
  const mostraGasto = lista?.some((p) => p.totalSpentCents !== null) ?? false;

  return (
    <>
      <Cabecalho
        titulo="Pacientes"
        descricao={
          st
            ? `${st.total} ${st.total === 1 ? 'paciente' : 'pacientes'} · cada ficha aberta fica registrada com quem abriu e quando.`
            : 'Cada ficha aberta fica registrada com quem abriu e quando.'
        }
        acoes={
          <>
            {gerencia ? (
              <Botao onClick={() => setImportar(true)}>
                <Icone nome="upload" className="h-4 w-4" /> Importar planilha
              </Botao>
            ) : null}
            <Botao variante="principal" onClick={() => setAberto('novo')}>
              <Icone nome="mais" className="h-4 w-4" /> Novo paciente
            </Botao>
          </>
        }
      />

      {st ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador
            icone="pessoas"
            rotulo="Pacientes cadastrados"
            valor={st.total}
            nota={
              st.newLast30 ? `${st.newLast30} novos nos últimos 30 dias` : 'nenhum novo em 30 dias'
            }
          />
          <Indicador
            icone="relogio"
            rotulo="Retorno vencido"
            valor={st.recallOverdue}
            nota="6 meses sem consulta"
            tom="ambar"
            acao={st.recallOverdue ? () => setFiltro('recall') : undefined}
          />
          <Indicador
            icone="globo"
            rotulo="Vieram pelo site"
            valor={st.total ? `${Math.round((st.fromSite / st.total) * 100)}%` : '—'}
            nota={`${st.fromSite} ${st.fromSite === 1 ? 'agendou' : 'agendaram'} online`}
            acao={st.fromSite ? () => setFiltro('site') : undefined}
          />
          <Indicador
            icone="agenda"
            rotulo="Aniversariantes do mês"
            valor={st.birthdaysThisMonth}
            nota="boa hora para um contato"
            acao={st.birthdaysThisMonth ? () => setFiltro('birthdays') : undefined}
          />
        </div>
      ) : (
        <div className="mb-6 grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[7.5rem] rounded-3xl bg-trilho" />
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl bg-folha ring-1 ring-linha">
        <div className="flex flex-wrap items-center gap-3 border-b border-linha p-3 sm:p-4">
          <div className="relative w-full sm:max-w-xs">
            <Icone
              nome="busca"
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-bruma"
            />
            <Entrada
              placeholder="Buscar por nome, WhatsApp ou CPF"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="rolagem-fina -mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={`h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors ${
                  filtro === f.id
                    ? 'bg-petroleo text-white'
                    : 'text-nevoa hover:bg-trilho hover:text-tinta'
                }`}
              >
                {f.nome}
              </button>
            ))}
          </div>
        </div>

        {lista === null ? (
          <p className="p-6 text-sm text-bruma">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="p-6">
            <Vazio
              titulo={q || filtro !== 'all' ? 'Ninguém encontrado' : 'Nenhum paciente ainda'}
              texto={
                q
                  ? 'Confira o nome ou busque pelo WhatsApp.'
                  : filtro !== 'all'
                    ? 'Nenhum paciente neste filtro agora.'
                    : 'Os pacientes aparecem aqui ao agendar, ou você importa a lista do sistema antigo.'
              }
            />
          </div>
        ) : (
          <>
            <table className="w-full text-left">
              <thead className="border-b border-linha text-xs font-semibold text-nevoa">
                <tr>
                  <th className="px-5 py-3">Paciente</th>
                  <th className="hidden px-5 py-3 md:table-cell">Última consulta</th>
                  <th className="hidden px-5 py-3 lg:table-cell">Próxima</th>
                  {mostraGasto ? (
                    <th className="hidden px-5 py-3 text-right xl:table-cell">Total pago</th>
                  ) : null}
                  <th className="px-5 py-3 text-right sm:text-left">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {lista.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer transition-colors hover:bg-porcelana"
                    onClick={() => (location.hash = `paciente/${p.id}`)}
                  >
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar nome={p.name} cor="#56676f" tamanho="h-9 w-9 text-xs" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <span className="truncate">{p.name}</span>
                            {p.hasAlerts ? (
                              <span
                                title="Alergia ou medicamento na ficha"
                                className="text-ambar-tinta"
                              >
                                <Icone nome="alerta" className="h-4 w-4" />
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-sm text-nevoa tabular-nums">
                            {[telefone(p.phone), idade(p.birthDate)].filter(Boolean).join(' · ') ||
                              '—'}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-5 py-3 md:table-cell">
                      {p.lastVisit ? (
                        <>
                          <span className="block tabular-nums">{data(p.lastVisit.at)}</span>
                          <span className="block max-w-[14rem] truncate text-sm text-nevoa">
                            {p.lastVisit.service}
                          </span>
                        </>
                      ) : (
                        <span className="text-bruma">—</span>
                      )}
                    </td>
                    <td className="hidden px-5 py-3 text-nevoa lg:table-cell">
                      {p.nextAppointment ? (
                        <span className="tabular-nums">{quando(p.nextAppointment)}</span>
                      ) : (
                        <span className="text-bruma">—</span>
                      )}
                    </td>
                    {mostraGasto ? (
                      <td className="hidden px-5 py-3 text-right font-semibold tabular-nums xl:table-cell">
                        {p.totalSpentCents ? (
                          formatBRL(p.totalSpentCents)
                        ) : (
                          <span className="font-normal text-bruma">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-5 py-3 text-right sm:text-left">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${SITUACAO[p.situation].estilo}`}
                      >
                        {SITUACAO[p.situation].nome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dados && dados.rows.length < dados.count ? (
              <div className="border-t border-linha p-3 text-center">
                <Botao variante="discreto" disabled={mais} onClick={carregarMais}>
                  {mais ? 'Carregando…' : `Mostrar mais (${dados.count - dados.rows.length})`}
                </Botao>
              </div>
            ) : null}
          </>
        )}
      </div>

      <Ficha id={aberto} aoFechar={() => setAberto(null)} aoSalvar={() => void buscar()} />
      <Importar
        aberto={importar}
        aoFechar={() => setImportar(false)}
        aoImportar={() => void buscar()}
      />
    </>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
  nota,
  tom,
  acao,
}: {
  icone: string;
  rotulo: string;
  valor: number | string;
  nota: string;
  tom?: 'ambar';
  acao?: (() => void) | undefined;
}) {
  const corpo = (
    <>
      <span className="flex items-center gap-2.5 text-sm font-semibold text-nevoa">
        <span
          className={`grid h-8 w-8 place-items-center rounded-xl ${tom === 'ambar' ? 'bg-ambar-fundo text-ambar-tinta' : 'bg-agua text-petroleo'}`}
        >
          <Icone nome={icone} className="h-4 w-4" />
        </span>
        {rotulo}
      </span>
      <span className="mt-3 block text-[1.75rem] leading-none font-bold tracking-tight tabular-nums">
        {valor}
      </span>
      <span className="mt-2 flex items-center justify-between gap-2 text-sm text-nevoa">
        {nota}
        {acao ? <span className="shrink-0 font-semibold text-petroleo">Ver lista</span> : null}
      </span>
    </>
  );
  const classe = 'block rounded-3xl bg-folha p-5 text-left ring-1 ring-linha';
  return acao ? (
    <button type="button" onClick={acao} className={`${classe} transition hover:ring-petroleo/40`}>
      {corpo}
    </button>
  ) : (
    <div className={classe}>{corpo}</div>
  );
}

const VAZIO: Partial<Patient> = {
  name: '',
  phone: '',
  email: '',
  birthDate: null,
  cpf: null,
  allergies: '',
  medications: '',
  notes: '',
};

export function Ficha({
  id,
  aoFechar,
  aoSalvar,
}: {
  id: string | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { avisar } = usePainel();
  const [p, setP] = useState<Partial<Patient> | null>(null);
  useEffect(() => {
    if (id === 'novo') setP({ ...VAZIO });
    else if (id)
      api
        .patient(id)
        .then((x) => setP({ ...x, phone: x.phone ? telefone(x.phone) : '' }))
        .catch((e) => avisar(mensagem(e), 'erro'));
    else setP(null);
  }, [id, avisar]);

  const set = (k: keyof Patient) => (e: { target: { value: string } }) =>
    setP({ ...p, [k]: e.target.value });

  async function salvar() {
    if (!p) return;
    const dados = {
      name: p.name ?? '',
      phone: p.phone ?? '',
      email: p.email ?? '',
      birthDate: p.birthDate || null,
      cpf: p.cpf || null,
      allergies: p.allergies ?? '',
      medications: p.medications ?? '',
      notes: p.notes ?? '',
    };
    try {
      if (id === 'novo') await api.createPatient(dados);
      else await api.updatePatient(id!, dados);
      avisar('Ficha salva');
      aoSalvar();
      aoFechar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <Gaveta
      aberta={id !== null}
      aoFechar={aoFechar}
      titulo={id === 'novo' ? 'Novo paciente' : (p?.name ?? '')}
      subtitulo={
        p && id !== 'novo'
          ? [p.phone, idade(p.birthDate ?? null)].filter(Boolean).join(' · ')
          : undefined
      }
      rodape={
        <Botao variante="principal" className="flex-1" onClick={salvar}>
          Salvar ficha
        </Botao>
      }
    >
      {p ? (
        <div className="space-y-6">
          <div className="space-y-4">
            <Campo rotulo="Nome completo">
              <Entrada value={p.name ?? ''} onChange={set('name')} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="WhatsApp">
                <Entrada
                  inputMode="tel"
                  value={p.phone ?? ''}
                  onChange={set('phone')}
                  placeholder="(81) 99999-0000"
                />
              </Campo>
              <Campo rotulo="Nascimento">
                <Entrada type="date" value={p.birthDate ?? ''} onChange={set('birthDate')} />
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="E-mail">
                <Entrada type="email" value={p.email ?? ''} onChange={set('email')} />
              </Campo>
              <Campo rotulo="CPF">
                <Entrada inputMode="numeric" value={p.cpf ?? ''} onChange={set('cpf')} />
              </Campo>
            </div>
          </div>
          <div className="space-y-4 rounded-2xl bg-ambar-fundo/60 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ambar-tinta">
              <Icone nome="alerta" className="h-4 w-4" /> Aparecem em destaque na agenda
            </p>
            <Campo rotulo="Alergias">
              <Entrada
                value={p.allergies ?? ''}
                onChange={set('allergies')}
                placeholder="Ex.: dipirona, látex"
              />
            </Campo>
            <Campo rotulo="Medicamentos em uso">
              <Entrada value={p.medications ?? ''} onChange={set('medications')} />
            </Campo>
          </div>
          <Campo rotulo="Observações">
            <Texto value={p.notes ?? ''} onChange={set('notes')} />
          </Campo>
          {p.appointments?.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-nevoa">Consultas</h3>
              <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
                {p.appointments.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.serviceName}</span>
                      <span className="text-nevoa">
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
            </section>
          ) : null}
          {p.consentAt ? (
            <p className="text-xs text-bruma">
              Aceite do uso dos dados em {dataHora(p.consentAt)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </Gaveta>
  );
}

// ---------------------------------------------------------------- importação

const COLUNAS: Record<string, string> = {
  nome: 'name',
  'nome completo': 'name',
  paciente: 'name',
  telefone: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  fone: 'phone',
  email: 'email',
  'e-mail': 'email',
  nascimento: 'birthDate',
  'data de nascimento': 'birthDate',
  cpf: 'cpf',
  observacoes: 'notes',
  observações: 'notes',
  obs: 'notes',
};

/** Lê CSV (vírgula ou ponto e vírgula, com aspas) e converte datas dd/mm/aaaa. */
function lerPlanilha(texto: string): Array<Record<string, string>> {
  const linhas = texto
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep =
    (linhas[0]!.match(/;/g)?.length ?? 0) > (linhas[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const partir = (l: string) => {
    const out: string[] = [];
    let atual = '';
    let aspas = false;
    for (const ch of l) {
      if (ch === '"') aspas = !aspas;
      else if (ch === sep && !aspas) {
        out.push(atual);
        atual = '';
      } else atual += ch;
    }
    out.push(atual);
    return out.map((c) => c.trim());
  };
  const cab = partir(linhas[0]!).map((c) => COLUNAS[c.toLowerCase()] ?? '');
  return linhas.slice(1).flatMap((l) => {
    const cels = partir(l);
    const row: Record<string, string> = {};
    cab.forEach((k, i) => {
      if (k && cels[i]) row[k] = cels[i]!;
    });
    if (row.birthDate) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(row.birthDate);
      if (m) row.birthDate = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    }
    return row.name && row.name.length >= 2 ? [row] : [];
  });
}

function Importar({
  aberto,
  aoFechar,
  aoImportar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoImportar: () => void;
}) {
  const { avisar } = usePainel();
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<Awaited<ReturnType<typeof api.importPatients>> | null>(
    null,
  );
  const linhas = lerPlanilha(texto);
  return (
    <Gaveta
      aberta={aberto}
      aoFechar={() => {
        setTexto('');
        setResultado(null);
        aoFechar();
      }}
      titulo="Importar pacientes"
      subtitulo="Planilha em CSV exportada do sistema antigo ou do Excel."
      rodape={
        <Botao
          variante="principal"
          className="flex-1"
          disabled={!linhas.length}
          onClick={async () => {
            try {
              const r = await api.importPatients(linhas);
              setResultado(r);
              avisar(`${r.created} pacientes importados`);
              aoImportar();
            } catch (e) {
              avisar(mensagem(e), 'erro');
            }
          }}
        >
          {linhas.length ? `Importar ${linhas.length} pacientes` : 'Importar'}
        </Botao>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-nevoa">
          A primeira linha precisa ter os nomes das colunas. Reconhecemos <strong>nome</strong>,{' '}
          <strong>telefone</strong> (ou celular, WhatsApp), <strong>e-mail</strong>,{' '}
          <strong>nascimento</strong>, <strong>CPF</strong> e <strong>observações</strong>. Quem já
          está cadastrado é pulado.
        </p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-linha bg-porcelana px-4 py-6 font-semibold text-petroleo hover:bg-agua">
          <Icone nome="upload" className="h-5 w-5" /> Escolher arquivo .csv
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setTexto(await f.text());
            }}
          />
        </label>
        <Campo rotulo="Ou cole aqui">
          <Texto
            rows={7}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={'nome;telefone;nascimento\nAna Souza;81999990000;02/05/1990'}
            className="font-mono text-sm"
          />
        </Campo>
        {linhas.length ? (
          <p className="text-sm font-medium text-ok">
            {linhas.length} linhas prontas para importar.
          </p>
        ) : null}
        {resultado ? (
          <div className="rounded-2xl bg-porcelana p-4 text-sm">
            <p className="font-semibold">{resultado.created} importados.</p>
            {resultado.skipped.length ? (
              <ul className="mt-2 space-y-1 text-nevoa">
                {resultado.skipped.slice(0, 20).map((s) => (
                  <li key={s.line}>
                    Linha {s.line + 1}: {s.name} ({s.reason.toLowerCase()})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Gaveta>
  );
}
