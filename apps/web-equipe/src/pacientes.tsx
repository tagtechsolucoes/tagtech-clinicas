import { useEffect, useState } from 'react';
import { STATUS_LABELS } from '@tagtech/domain';
import { api, type Patient, type PatientSummary } from './api';
import { mensagem, usePainel } from './contexto';
import { dataHora, idade, telefone } from './formato';
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

export function PacientesTela() {
  const { avisar, gerencia } = usePainel();
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<PatientSummary[] | null>(null);
  const [aberto, setAberto] = useState<string | 'novo' | null>(null);
  const [importar, setImportar] = useState(false);

  const buscar = () =>
    api
      .patients(q, 100)
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    const t = setTimeout(buscar, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <>
      <Cabecalho
        titulo="Pacientes"
        descricao="Cada ficha aberta fica registrada com quem abriu e quando."
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
      <div className="relative mb-5 max-w-md">
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

      {lista === null ? null : lista.length === 0 ? (
        <Vazio
          titulo={q ? 'Ninguém encontrado' : 'Nenhum paciente ainda'}
          texto={
            q
              ? 'Confira o nome ou busque pelo WhatsApp.'
              : 'Os pacientes aparecem aqui ao agendar, ou você importa a lista do sistema antigo.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-folha ring-1 ring-linha">
          <table className="w-full text-left">
            <thead className="border-b border-linha text-xs font-semibold text-nevoa">
              <tr>
                <th className="px-5 py-3">Nome</th>
                <th className="hidden px-5 py-3 sm:table-cell">WhatsApp</th>
                <th className="hidden px-5 py-3 md:table-cell">Idade</th>
                <th className="w-10 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {lista.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-porcelana"
                  onClick={() => setAberto(p.id)}
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <Avatar nome={p.name} cor="#56676f" tamanho="h-8 w-8 text-xs" />
                      <span className="font-medium">{p.name}</span>
                      {p.hasAlerts ? (
                        <span title="Alergia ou medicamento na ficha" className="text-ambar-tinta">
                          <Icone nome="alerta" className="h-4 w-4" />
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="hidden px-5 py-3 text-nevoa tabular-nums sm:table-cell">
                    {telefone(p.phone) || '—'}
                  </td>
                  <td className="hidden px-5 py-3 text-nevoa md:table-cell">
                    {idade(p.birthDate) ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-bruma">
                    <Icone nome="direita" className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Ficha id={aberto} aoFechar={() => setAberto(null)} aoSalvar={() => void buscar()} />
      <Importar
        aberto={importar}
        aoFechar={() => setImportar(false)}
        aoImportar={() => void buscar()}
      />
    </>
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

function Ficha({
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
