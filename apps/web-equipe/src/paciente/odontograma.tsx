import { useEffect, useState } from 'react';
import {
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  TOOTH_STATE_LABELS,
  TOOTH_STATES,
  type ToothState,
} from '@tagtech/domain';
import { api, type Tooth } from '../api';
import { mensagem, usePainel } from '../contexto';
import { Botao, Entrada } from '../ui';

/** Cor de cada estado. Texto e cor juntos: o estado também aparece escrito. */
const COR: Record<ToothState, { fundo: string; borda: string; texto: string }> = {
  healthy: { fundo: '#e2f2e9', borda: '#2a7f52', texto: '#1d5a3a' },
  caries: { fundo: '#fbe8e9', borda: '#b8303a', texto: '#8c1f28' },
  restored: { fundo: '#e8eefb', borda: '#3563c9', texto: '#244a9e' },
  root_canal: { fundo: '#f3e8fb', borda: '#7a4fb8', texto: '#5a3590' },
  crown: { fundo: '#fdf1dc', borda: '#b47a12', texto: '#7a4d05' },
  implant: { fundo: '#e2edf0', borda: '#1d4e5f', texto: '#123542' },
  prosthesis: { fundo: '#eef0e0', borda: '#6b7a1f', texto: '#4b5614' },
  extraction: { fundo: '#fff', borda: '#b8303a', texto: '#b8303a' },
  missing: { fundo: '#eaeff1', borda: '#8a9aa1', texto: '#56676f' },
};

export function Odontograma({ patientId }: { patientId: string }) {
  const { avisar } = usePainel();
  const [dentes, setDentes] = useState<Map<number, Tooth>>(new Map());
  const [leite, setLeite] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [nota, setNota] = useState('');

  const carregar = () =>
    api
      .teeth(patientId)
      .then((t) => setDentes(new Map(t.map((x) => [x.tooth, x]))))
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const arcos = leite ? PRIMARY_TEETH : PERMANENT_TEETH;

  async function marcar(tooth: number, state: ToothState | null) {
    try {
      await api.setTooth(patientId, tooth, state, state ? nota.trim() : '');
      await carregar();
      setAberto(null);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const Linha = ({ numeros, cima }: { numeros: number[]; cima: boolean }) => (
    <div className="flex justify-center gap-1 sm:gap-1.5">
      {numeros.map((n, i) => {
        const d = dentes.get(n);
        const cor = d ? COR[d.state] : null;
        const meio = i === numeros.length / 2;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={aberto === n}
            aria-label={`Dente ${n}${d ? `: ${TOOTH_STATE_LABELS[d.state]}` : ''}`}
            title={
              d ? `${TOOTH_STATE_LABELS[d.state]}${d.note ? ` · ${d.note}` : ''}` : 'Sem registro'
            }
            onClick={() => {
              setAberto(aberto === n ? null : n);
              setNota(d?.note ?? '');
            }}
            className={`flex w-9 flex-col items-center gap-1 sm:w-11 ${meio ? 'ml-3 sm:ml-5' : ''} ${cima ? '' : 'flex-col-reverse'}`}
          >
            <span className="text-[0.7rem] font-semibold text-nevoa tabular-nums">{n}</span>
            <span
              className={`grid h-11 w-full place-items-center rounded-[0.9rem] border-2 text-[0.65rem] font-bold transition ${
                aberto === n ? 'ring-2 ring-tinta ring-offset-2' : ''
              } ${d?.state === 'missing' ? 'border-dashed' : ''}`}
              style={{
                background: cor?.fundo ?? '#ffffff',
                borderColor: cor?.borda ?? '#dce3e6',
                color: cor?.texto ?? 'transparent',
              }}
            >
              {d?.state === 'extraction' ? '✕' : d ? TOOTH_STATE_LABELS[d.state].slice(0, 3) : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  const atual = aberto !== null ? dentes.get(aberto) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-nevoa">
          Clique no dente para marcar. Numeração FDI, vista de frente para o paciente.
        </p>
        <div role="group" aria-label="Dentição" className="flex rounded-xl bg-trilho p-1">
          {[
            [false, 'Permanente'],
            [true, 'Decídua'],
          ].map(([v, nome]) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={leite === v}
              onClick={() => setLeite(v as boolean)}
              className={`h-8 rounded-lg px-3 text-sm font-semibold ${leite === v ? 'bg-folha shadow-sm' : 'text-nevoa'}`}
            >
              {nome as string}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl bg-folha px-4 py-8 ring-1 ring-linha">
        <div className="mx-auto w-max space-y-5">
          <Linha numeros={arcos.upper} cima />
          <div className="mx-6 border-t border-dashed border-linha" />
          <Linha numeros={arcos.lower} cima={false} />
        </div>
      </div>

      {aberto !== null ? (
        <section className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
          <h3 className="font-display text-xl">Dente {aberto}</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {TOOTH_STATES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={atual?.state === s}
                onClick={() => marcar(aberto, s)}
                className="h-10 rounded-xl border-2 px-3 text-sm font-semibold"
                style={{
                  background: COR[s].fundo,
                  borderColor: atual?.state === s ? COR[s].texto : COR[s].borda,
                  color: COR[s].texto,
                }}
              >
                {TOOTH_STATE_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Entrada
              placeholder="Observação (faces, material…)"
              value={nota}
              maxLength={200}
              onChange={(e) => setNota(e.target.value)}
            />
            {atual ? (
              <Botao onClick={() => marcar(aberto, atual.state)}>Salvar observação</Botao>
            ) : null}
            {atual ? (
              <Botao variante="discreto" onClick={() => marcar(aberto, null)}>
                Limpar
              </Botao>
            ) : null}
          </div>
        </section>
      ) : null}

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {TOOTH_STATES.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 rounded border-2"
              style={{ background: COR[s].fundo, borderColor: COR[s].borda }}
            />
            {TOOTH_STATE_LABELS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
