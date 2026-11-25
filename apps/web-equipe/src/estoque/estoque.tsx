import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type StockItem, type Supplier } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro } from '../formato';
import { Botao, Cabecalho, Entrada, Icone, Vazio } from '../ui';
import { qtd, situacao, TOM } from './comum';
import { Compras } from './compras';
import { Entrada as EntradaCompra, type Prefill } from './entrada';
import { Fornecedores } from './fornecedores';
import { MaterialDetalhe, MaterialForm } from './material';
import { Relatorio } from './relatorio';

type Aba = 'materiais' | 'compras' | 'fornecedores' | 'relatorio';

/** Estoque: materiais, lista de compras, fornecedores e relatório. */
export function EstoqueTela() {
  const { avisar, gerencia } = usePainel();
  const [aba, setAba] = useState<Aba>('materiais');
  const [itens, setItens] = useState<StockItem[] | null>(null);
  const [fornecedores, setFornecedores] = useState<Supplier[]>([]);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<StockItem | null>(null);
  const [form, setForm] = useState<StockItem | 'novo' | null>(null);
  const [entrada, setEntrada] = useState<Prefill | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [i, f] = await Promise.all([api.stock(), api.suppliers()]);
      setItens(i);
      setFornecedores(f);
      setAberto((a) => (a ? (i.find((x) => x.id === a.id) ?? null) : null));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }, [avisar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abas: Array<[Aba, string]> = [
    ['materiais', 'Materiais'],
    ['compras', 'Lista de compras'],
    ['fornecedores', 'Fornecedores'],
    ...(gerencia ? ([['relatorio', 'Relatório']] as Array<[Aba, string]>) : []),
  ];

  const faltas = (itens ?? []).filter((i) => i.shortage);
  const atencao = (itens ?? []).filter(
    (i) => !i.shortage && ['alerta', 'ambar'].includes(situacao(i).tom),
  );

  return (
    <>
      <Cabecalho
        titulo="Estoque"
        descricao="O estoque olha a agenda: avisa antes de uma consulta ficar sem material e monta o pedido de cada fornecedor."
        acoes={
          <>
            <Botao onClick={() => setForm('novo')}>
              <Icone nome="mais" className="h-4 w-4" /> Novo material
            </Botao>
            <Botao variante="principal" onClick={() => setEntrada({})}>
              <Icone nome="upload" className="h-4 w-4 rotate-180" /> Entrada de compra
            </Botao>
          </>
        }
      />

      {faltas.length ? (
        <section className="mb-8 overflow-hidden rounded-3xl bg-alerta-fundo text-alerta ring-1 ring-alerta/20">
          <div className="flex flex-wrap items-center gap-4 px-6 py-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-alerta text-white">
              <Icone nome="alerta" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl">
                {faltas.length === 1
                  ? '1 material vai faltar para a agenda'
                  : `${faltas.length} materiais vão faltar para a agenda`}
              </p>
              <p className="mt-0.5 text-sm text-tinta/70">
                {faltas
                  .slice(0, 3)
                  .map((f) => f.name)
                  .join(', ')}
                {faltas.length > 3 ? ` e mais ${faltas.length - 3}` : ''}
              </p>
            </div>
            <Botao variante="principal" onClick={() => setAba('compras')}>
              Ver lista de compras
            </Botao>
          </div>
        </section>
      ) : null}

      <nav aria-label="Estoque" className="mb-7 flex gap-1 overflow-x-auto border-b border-linha">
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
            {k === 'compras' && faltas.length + atencao.length ? (
              <span className="ml-2 rounded-full bg-ambar px-1.5 py-0.5 text-xs text-tinta tabular-nums">
                {faltas.length + atencao.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {aba === 'materiais' ? (
        <Materiais
          itens={itens}
          busca={busca}
          setBusca={setBusca}
          aoAbrir={setAberto}
          aoNovo={() => setForm('novo')}
        />
      ) : null}
      {aba === 'compras' ? (
        <Compras
          fornecedores={fornecedores}
          itens={itens ?? []}
          aoReceber={setEntrada}
          aoMudar={carregar}
        />
      ) : null}
      {aba === 'fornecedores' ? <Fornecedores lista={fornecedores} aoMudar={carregar} /> : null}
      {aba === 'relatorio' ? <Relatorio /> : null}

      <MaterialDetalhe
        item={aberto}
        aoFechar={() => setAberto(null)}
        aoEditar={(i) => {
          setAberto(null);
          setForm(i);
        }}
        aoMudar={carregar}
      />
      <MaterialForm
        item={form}
        fornecedores={fornecedores}
        aoFechar={() => setForm(null)}
        aoSalvar={() => {
          setForm(null);
          void carregar();
        }}
      />
      <EntradaCompra
        prefill={entrada}
        itens={itens ?? []}
        fornecedores={fornecedores}
        aoFechar={() => setEntrada(null)}
        aoSalvar={() => {
          setEntrada(null);
          void carregar();
        }}
      />
    </>
  );
}

function Materiais({
  itens,
  busca,
  setBusca,
  aoAbrir,
  aoNovo,
}: {
  itens: StockItem[] | null;
  busca: string;
  setBusca: (v: string) => void;
  aoAbrir: (i: StockItem) => void;
  aoNovo: () => void;
}) {
  const ordem = { alerta: 0, ambar: 1, azul: 2, ok: 3, neutro: 4 } as const;
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    return (itens ?? [])
      .filter((i) => i.active)
      .filter(
        (i) =>
          !t ||
          `${i.name} ${i.category}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .includes(t),
      )
      .sort(
        (a, b) => ordem[situacao(a).tom] - ordem[situacao(b).tom] || a.name.localeCompare(b.name),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, busca]);

  if (!itens) return <p className="text-nevoa">Carregando…</p>;
  if (!itens.length)
    return (
      <Vazio
        titulo="Nenhum material cadastrado"
        texto="Cadastre os materiais e ligue cada um aos procedimentos. Ao finalizar a consulta, o material sai sozinho."
        acao={
          <Botao variante="principal" onClick={aoNovo}>
            Cadastrar o primeiro
          </Botao>
        }
      />
    );

  const total = itens.reduce((s, i) => s + i.valueCents, 0);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Icone
            nome="busca"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-bruma"
          />
          <Entrada
            placeholder="Buscar material"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-10"
          />
        </div>
        <p className="ml-auto text-sm text-nevoa">
          {itens.length} materiais ·{' '}
          <strong className="text-tinta tabular-nums">{dinheiro(total)}</strong> em estoque
        </p>
      </div>
      <ul className="divide-y divide-linha overflow-hidden rounded-2xl bg-folha ring-1 ring-linha">
        {lista.map((i) => {
          const s = situacao(i);
          const fim = i.daysLeft === null ? null : Math.min(1, i.daysLeft / 60);
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => aoAbrir(i)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 text-left hover:bg-porcelana sm:grid-cols-[minmax(0,1.4fr)_9rem_minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{i.name}</span>
                  <span className="block truncate text-sm text-nevoa">
                    {[i.category, i.supplierName].filter(Boolean).join(' · ') || 'Sem categoria'}
                  </span>
                </span>
                <span className="text-right font-semibold tabular-nums sm:text-left">
                  {qtd(i.qty, i.unit)}
                  {i.onOrder > 0 ? (
                    <span className="block text-xs font-medium text-azul">
                      +{qtd(i.onOrder)} pedido
                    </span>
                  ) : null}
                </span>
                <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                  <span
                    className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-trilho"
                    aria-hidden
                  >
                    {fim !== null ? (
                      <span
                        className={`block h-full rounded-full ${fim < 0.25 ? 'bg-alerta' : fim < 0.5 ? 'bg-ambar' : 'bg-petroleo'}`}
                        style={{ width: `${Math.max(4, fim * 100)}%` }}
                      />
                    ) : null}
                  </span>
                </span>
                <span
                  className={`col-span-2 w-fit rounded-md px-2 py-0.5 text-xs font-semibold sm:col-span-1 sm:justify-self-end ${TOM[s.tom]}`}
                >
                  {s.texto}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
