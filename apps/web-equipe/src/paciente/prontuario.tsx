import { useEffect, useMemo, useState } from 'react';
import {
  bmi,
  RECORD_KINDS,
  RECORD_TEMPLATES,
  type RecordField,
  type RecordKind,
} from '@tagtech/domain';
import { api, type ClinicalNote } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataHora } from '../formato';
import { Botao, Campo, Entrada, Icone, Seletor, Texto } from '../ui';

/** Evoluções do paciente: escrever (com o modelo da especialidade) e a linha do tempo. */
export function Prontuario({ patientId }: { patientId: string }) {
  const { professionals, avisar } = usePainel();
  const [notas, setNotas] = useState<ClinicalNote[] | null>(null);
  const [adendo, setAdendo] = useState<ClinicalNote | null>(null);

  // O modelo padrão é o mais usado pelos profissionais da clínica (dá para trocar na hora).
  const padrao = useMemo<RecordKind>(() => {
    const conta = new Map<RecordKind, number>();
    for (const p of professionals.filter((x) => x.active))
      conta.set(p.recordKind, (conta.get(p.recordKind) ?? 0) + 1);
    return [...conta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'geral';
  }, [professionals]);

  const carregar = () =>
    api
      .notes(patientId)
      .then(setNotas)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const principais = (notas ?? []).filter((n) => !n.addendumOf);
  const adendos = (id: string) => (notas ?? []).filter((n) => n.addendumOf === id).reverse();

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:items-start">
      <Editor
        key={adendo?.id ?? 'nova'}
        patientId={patientId}
        padrao={adendo?.kind ?? padrao}
        adendoDe={adendo}
        aoCancelarAdendo={() => setAdendo(null)}
        aoSalvar={() => {
          setAdendo(null);
          void carregar();
        }}
      />
      <section>
        {notas === null ? (
          <p className="text-nevoa">Carregando o prontuário…</p>
        ) : principais.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-linha px-6 py-10 text-center text-nevoa">
            Nenhuma evolução ainda. A primeira fica à esquerda.
          </p>
        ) : (
          <ol className="space-y-4">
            {principais.map((n) => (
              <li key={n.id}>
                <Cartao
                  n={n}
                  aoMudar={() => void carregar()}
                  aoAdendo={() => {
                    setAdendo(n);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
                {adendos(n.id).map((x) => (
                  <div key={x.id} className="mt-2 ml-6 border-l-2 border-linha pl-4">
                    <Cartao n={x} aoMudar={() => void carregar()} />
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function CampoModelo({
  f,
  valor,
  aoMudar,
}: {
  f: RecordField;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  if (f.type === 'scale') {
    const n = valor === '' ? null : Number(valor);
    return (
      <div>
        <span className="mb-1.5 block text-[0.82rem] font-semibold text-nevoa">
          {f.label}{' '}
          {n !== null ? (
            <span className="text-tinta">
              · {n}/{f.max}
            </span>
          ) : null}
        </span>
        <div className="flex gap-1">
          {Array.from({ length: (f.max ?? 10) + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={n === i}
              onClick={() => aoMudar(n === i ? '' : String(i))}
              className={`h-9 flex-1 rounded-lg text-sm font-semibold tabular-nums transition ${
                n !== null && i <= n
                  ? i >= 7
                    ? 'bg-alerta text-white'
                    : i >= 4
                      ? 'bg-ambar text-tinta'
                      : 'bg-ok text-white'
                  : 'bg-folha ring-1 ring-linha'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <Campo rotulo={f.unit ? `${f.label} (${f.unit})` : f.label}>
      {f.type === 'textarea' ? (
        <Texto rows={3} value={valor} onChange={(e) => aoMudar(e.target.value)} />
      ) : (
        <Entrada
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          value={valor}
          placeholder={f.placeholder}
          onChange={(e) => aoMudar(e.target.value)}
        />
      )}
    </Campo>
  );
}

function Editor({
  patientId,
  padrao,
  adendoDe,
  aoCancelarAdendo,
  aoSalvar,
}: {
  patientId: string;
  padrao: RecordKind;
  adendoDe: ClinicalNote | null;
  aoCancelarAdendo: () => void;
  aoSalvar: () => void;
}) {
  const { avisar } = usePainel();
  const [kind, setKind] = useState<RecordKind>(padrao);
  const [dados, setDados] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState('');
  const [sigilo, setSigilo] = useState(RECORD_TEMPLATES[padrao].privateByDefault);
  const [salvando, setSalvando] = useState(false);
  const modelo = RECORD_TEMPLATES[kind];
  const num = (v: string | undefined) => Number((v ?? '').replace(',', '.'));
  const imc =
    kind === 'nutri' && num(dados.peso) > 0 && num(dados.altura) > 0
      ? bmi(num(dados.peso), num(dados.altura))
      : null;

  async function salvar(finalizar: boolean) {
    setSalvando(true);
    try {
      const n = await api.createNote(patientId, {
        kind,
        data: dados,
        text: texto,
        private: sigilo,
        ...(adendoDe ? { addendumOf: adendoDe.id } : {}),
      });
      if (finalizar) await api.lockNote(n.id);
      setDados({});
      setTexto('');
      avisar(finalizar ? 'Evolução finalizada' : 'Evolução salva');
      aoSalvar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="rounded-3xl bg-folha p-5 ring-1 ring-linha xl:sticky xl:top-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-medium">{adendoDe ? 'Adendo' : 'Nova evolução'}</h2>
        {adendoDe ? (
          <button
            type="button"
            onClick={aoCancelarAdendo}
            className="text-sm font-semibold text-nevoa hover:text-tinta"
          >
            Cancelar
          </button>
        ) : (
          <div className="w-40">
            <Seletor
              aria-label="Modelo"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as RecordKind;
                setKind(k);
                setSigilo(RECORD_TEMPLATES[k].privateByDefault);
              }}
              className="h-9 text-sm"
            >
              {RECORD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RECORD_TEMPLATES[k].label}
                </option>
              ))}
            </Seletor>
          </div>
        )}
      </div>
      {adendoDe ? (
        <p className="mb-4 text-sm text-nevoa">
          Correção ou complemento da evolução de {dataHora(adendoDe.createdAt)}. A original fica
          como está.
        </p>
      ) : null}
      <div className="space-y-3.5">
        {(adendoDe ? [] : modelo.fields).map((f) => (
          <CampoModelo
            key={f.key}
            f={f}
            valor={dados[f.key] ?? ''}
            aoMudar={(v) => setDados({ ...dados, [f.key]: v })}
          />
        ))}
        {imc !== null ? (
          <p className="text-sm text-nevoa">
            IMC: <strong className="text-tinta">{imc}</strong>
          </p>
        ) : null}
        <Campo rotulo={adendoDe ? 'Texto do adendo' : 'Observações livres'}>
          <Texto rows={adendoDe ? 5 : 3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={sigilo}
            onChange={(e) => setSigilo(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-petroleo"
          />
          <span>
            <span className="font-semibold">Sigilosa</span>
            <span className="block text-nevoa">
              Só você lê o conteúdo. Os outros veem que existe uma evolução.
            </span>
          </span>
        </label>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Botao disabled={salvando} onClick={() => salvar(false)}>
          Salvar
        </Botao>
        <Botao variante="principal" disabled={salvando} onClick={() => salvar(true)}>
          Salvar e finalizar
        </Botao>
      </div>
      <p className="mt-2.5 text-xs text-bruma">
        Finalizada não muda mais. Correções entram como adendo.
      </p>
    </section>
  );
}

function Cartao({
  n,
  aoMudar,
  aoAdendo,
}: {
  n: ClinicalNote;
  aoMudar: () => void;
  aoAdendo?: () => void;
}) {
  const { avisar } = usePainel();
  const [editando, setEditando] = useState(false);
  const [dados, setDados] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(n.data).map(([k, v]) => [k, String(v)])),
  );
  const [texto, setTexto] = useState(n.text);
  const modelo = RECORD_TEMPLATES[n.kind];

  return (
    <article className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{dataHora(n.createdAt)}</span>
        <span className="text-nevoa">
          {n.addendumOf ? 'Adendo · ' : ''}
          {modelo.label} · {n.professionalName ?? n.author}
        </span>
        <span className="ml-auto flex gap-1.5">
          {n.private ? (
            <span className="rounded-md bg-trilho px-2 py-0.5 text-xs font-semibold text-nevoa">
              Sigilosa
            </span>
          ) : null}
          {n.locked ? (
            <span className="rounded-md bg-agua px-2 py-0.5 text-xs font-semibold text-petroleo">
              Finalizada
            </span>
          ) : (
            <span className="rounded-md bg-ambar-fundo px-2 py-0.5 text-xs font-semibold text-ambar-tinta">
              Em aberto
            </span>
          )}
        </span>
      </header>

      {n.hidden ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-nevoa">
          <Icone nome="bloqueio" className="h-4 w-4" /> Conteúdo sigiloso de {n.author}.
        </p>
      ) : editando ? (
        <div className="mt-4 space-y-3">
          {modelo.fields.map((f) => (
            <CampoModelo
              key={f.key}
              f={f}
              valor={dados[f.key] ?? ''}
              aoMudar={(v) => setDados({ ...dados, [f.key]: v })}
            />
          ))}
          <Campo rotulo="Observações livres">
            <Texto value={texto} onChange={(e) => setTexto(e.target.value)} />
          </Campo>
          <div className="flex gap-2">
            <Botao
              variante="principal"
              tamanho="pequeno"
              onClick={async () => {
                try {
                  await api.updateNote(n.id, { data: dados, text: texto });
                  setEditando(false);
                  aoMudar();
                } catch (e) {
                  avisar(mensagem(e), 'erro');
                }
              }}
            >
              Salvar
            </Botao>
            <Botao tamanho="pequeno" variante="discreto" onClick={() => setEditando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <dl className="mt-3 space-y-2.5">
          {modelo.fields
            .filter((f) => n.data[f.key] !== undefined)
            .map((f) => (
              <div key={f.key}>
                <dt className="text-xs font-semibold text-nevoa">{f.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line">
                  {f.type === 'scale'
                    ? `${n.data[f.key]}/${f.max}`
                    : `${n.data[f.key]}${f.unit ? ` ${f.unit}` : ''}`}
                </dd>
              </div>
            ))}
          {n.kind === 'nutri' && Number(n.data.peso) > 0 && Number(n.data.altura) > 0 ? (
            <div>
              <dt className="text-xs font-semibold text-nevoa">IMC</dt>
              <dd className="mt-0.5">{bmi(Number(n.data.peso), Number(n.data.altura))}</dd>
            </div>
          ) : null}
          {n.text ? <dd className="whitespace-pre-line text-[0.95rem]">{n.text}</dd> : null}
        </dl>
      )}

      {!n.hidden && !editando ? (
        <footer className="mt-4 flex flex-wrap gap-2">
          {n.mine && !n.locked ? (
            <>
              <Botao tamanho="pequeno" onClick={() => setEditando(true)}>
                Editar
              </Botao>
              <Botao
                tamanho="pequeno"
                onClick={async () => {
                  try {
                    await api.lockNote(n.id);
                    aoMudar();
                  } catch (e) {
                    avisar(mensagem(e), 'erro');
                  }
                }}
              >
                Finalizar
              </Botao>
            </>
          ) : null}
          {n.locked && aoAdendo ? (
            <Botao tamanho="pequeno" variante="discreto" onClick={aoAdendo}>
              Escrever adendo
            </Botao>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
