import { useEffect, useState } from 'react';
import { MOVE_LABELS, STOCK_UNITS } from '@tagtech/domain';
import { api, type StockItem, type StockLot, type StockMove, type Supplier } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dataHora, dinheiro, hoje } from '../formato';
import { Botao, Campo, Entrada, EntradaDinheiro, Gaveta, Icone, Seletor } from '../ui';
import { qtd, situacao, TOM } from './comum';

const numero = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Ficha do material: lotes, histórico, saída manual e contagem. */
export function MaterialDetalhe({
  item,
  aoFechar,
  aoEditar,
  aoMudar,
}: {
  item: StockItem | null;
  aoFechar: () => void;
  aoEditar: (i: StockItem) => void;
  aoMudar: () => Promise<void> | void;
}) {
  const { avisar } = usePainel();
  const [dados, setDados] = useState<{ lots: StockLot[]; moves: StockMove[] } | null>(null);
  const [modo, setModo] = useState<'saida' | 'contagem' | null>(null);
  const [saida, setSaida] = useState({
    kind: 'manual' as 'loss' | 'expired' | 'manual',
    qty: '',
    reason: '',
  });
  const [contado, setContado] = useState('');

  const carregar = () =>
    item
      ? api
          .itemMoves(item.id)
          .then(setDados)
          .catch((e) => avisar(mensagem(e), 'erro'))
      : Promise.resolve();
  useEffect(() => {
    setDados(null);
    setModo(null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.qty]);

  async function agir(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      avisar(ok);
      setModo(null);
      setSaida({ kind: 'manual', qty: '', reason: '' });
      setContado('');
      await aoMudar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const s = item ? situacao(item) : null;
  return (
    <Gaveta
      aberta={item !== null}
      aoFechar={aoFechar}
      titulo={item?.name ?? ''}
      subtitulo={item ? [item.category, item.supplierName].filter(Boolean).join(' · ') : undefined}
      rodape={
        item ? (
          <>
            <Botao onClick={() => aoEditar(item)}>
              <Icone nome="editar" className="h-4 w-4" /> Editar
            </Botao>
            <Botao
              className="flex-1"
              onClick={() => setModo(modo === 'contagem' ? null : 'contagem')}
            >
              Contagem
            </Botao>
            <Botao className="flex-1" onClick={() => setModo(modo === 'saida' ? null : 'saida')}>
              Saída manual
            </Botao>
          </>
        ) : null
      }
    >
      {item && s ? (
        <div className="space-y-7">
          <section className="rounded-3xl bg-petroleo p-5 text-white">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-4xl tabular-nums">{qtd(item.qty, item.unit)}</p>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TOM[s.tom]}`}>
                {s.texto}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/15 pt-4 text-sm">
              <div>
                <dt className="text-white/65">Na agenda (30 dias)</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{qtd(item.scheduled30)}</dd>
              </div>
              <div>
                <dt className="text-white/65">Usado (30 dias)</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{qtd(item.used30)}</dd>
              </div>
              <div>
                <dt className="text-white/65">Valor parado</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{dinheiro(item.valueCents)}</dd>
              </div>
            </dl>
          </section>

          {modo === 'saida' ? (
            <section className="space-y-3 rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
              <h3 className="font-semibold">Saída manual</h3>
              <div className="grid grid-cols-2 gap-3">
                <Seletor
                  aria-label="Motivo da saída"
                  value={saida.kind}
                  onChange={(e) =>
                    setSaida({ ...saida, kind: e.target.value as typeof saida.kind })
                  }
                >
                  <option value="manual">{MOVE_LABELS.manual}</option>
                  <option value="loss">{MOVE_LABELS.loss}</option>
                  <option value="expired">{MOVE_LABELS.expired}</option>
                </Seletor>
                <Entrada
                  aria-label="Quantidade"
                  inputMode="decimal"
                  placeholder={`Quantidade (${item.unit})`}
                  value={saida.qty}
                  onChange={(e) => setSaida({ ...saida, qty: e.target.value })}
                />
              </div>
              <Entrada
                placeholder="O que aconteceu? (obrigatório)"
                maxLength={200}
                value={saida.reason}
                onChange={(e) => setSaida({ ...saida, reason: e.target.value })}
              />
              <Botao
                variante="principal"
                disabled={!numero(saida.qty) || saida.reason.trim().length < 3}
                onClick={() =>
                  agir(
                    () =>
                      api.stockOut(item.id, {
                        kind: saida.kind,
                        qty: numero(saida.qty),
                        reason: saida.reason.trim(),
                      }),
                    'Saída lançada',
                  )
                }
              >
                Lançar saída
              </Botao>
            </section>
          ) : null}

          {modo === 'contagem' ? (
            <section className="space-y-3 rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
              <h3 className="font-semibold">Quanto tem na prateleira?</h3>
              <p className="text-sm text-nevoa">
                O sistema diz {qtd(item.qty, item.unit)}. A diferença entra como ajuste de contagem.
              </p>
              <div className="flex gap-2">
                <Entrada
                  inputMode="decimal"
                  aria-label="Quantidade contada"
                  value={contado}
                  onChange={(e) => setContado(e.target.value)}
                />
                <Botao
                  variante="principal"
                  disabled={contado.trim() === ''}
                  onClick={() =>
                    agir(async () => {
                      const r = await api.stockCount(item.id, numero(contado));
                      if (r.difference === 0) avisar('Bateu certinho');
                    }, 'Contagem lançada')
                  }
                >
                  Lançar
                </Botao>
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Lotes no estoque</h3>
            {dados?.lots.length ? (
              <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
                {dados.lots.map((l) => {
                  const vencido = l.expiresOn !== null && l.expiresOn < hoje();
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{l.lot || 'Sem lote'}</span>
                        <span
                          className={`text-sm ${vencido ? 'font-semibold text-alerta' : 'text-nevoa'}`}
                        >
                          {l.expiresOn
                            ? `${vencido ? 'Venceu' : 'Vence'} ${dataCurta(l.expiresOn)}`
                            : 'Sem validade'}
                          {l.openedAt ? ' · aberto' : ''}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{qtd(l.qty, item.unit)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-nevoa">Nenhum lote com saldo.</p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Movimentação</h3>
            <ul className="space-y-1">
              {(dados?.moves ?? []).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-porcelana"
                >
                  <span
                    className={`w-20 shrink-0 text-right font-semibold tabular-nums ${m.qty > 0 ? 'text-ok' : 'text-tinta'}`}
                  >
                    {m.qty > 0 ? '+' : '−'}
                    {qtd(Math.abs(m.qty))}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{MOVE_LABELS[m.kind]}</span>
                    {m.patientName ? <span className="text-nevoa"> · {m.patientName}</span> : null}
                    {m.reason ? <span className="text-nevoa"> · {m.reason}</span> : null}
                    {m.lot ? <span className="text-bruma"> · lote {m.lot}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-bruma">{dataHora(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Gaveta>
  );
}

/** Cadastro e edição do material. */
export function MaterialForm({
  item,
  fornecedores,
  aoFechar,
  aoSalvar,
}: {
  item: StockItem | 'novo' | null;
  fornecedores: Supplier[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { avisar } = usePainel();
  const novo = item === 'novo';
  const [f, setF] = useState({
    name: '',
    category: '',
    unit: 'unidade',
    purchaseUnit: 'caixa',
    unitsPerPurchase: '1',
    minQty: '0',
    supplierId: '',
    openValidityDays: '',
    initialQty: '',
    initialExpiresOn: '',
  });
  const [custo, setCusto] = useState<number | null>(0);

  useEffect(() => {
    if (item === 'novo')
      setF({
        name: '',
        category: '',
        unit: 'unidade',
        purchaseUnit: 'caixa',
        unitsPerPurchase: '1',
        minQty: '0',
        supplierId: '',
        openValidityDays: '',
        initialQty: '',
        initialExpiresOn: '',
      });
    else if (item) {
      setF({
        name: item.name,
        category: item.category,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        unitsPerPurchase: String(item.unitsPerPurchase).replace('.', ','),
        minQty: String(item.minQty).replace('.', ','),
        supplierId: item.supplierId ?? '',
        openValidityDays: item.openValidityDays ? String(item.openValidityDays) : '',
        initialQty: '',
        initialExpiresOn: '',
      });
      setCusto(item.costCents);
    }
    if (item === 'novo') setCusto(0);
  }, [item]);

  async function salvar() {
    if (!f.name.trim()) return avisar('Informe o nome', 'erro');
    const corpo = {
      name: f.name.trim(),
      category: f.category.trim(),
      unit: f.unit,
      purchaseUnit: f.purchaseUnit,
      unitsPerPurchase: numero(f.unitsPerPurchase) || 1,
      minQty: numero(f.minQty),
      supplierId: f.supplierId || null,
      openValidityDays: f.openValidityDays ? Number(f.openValidityDays) : null,
      costCents: custo ?? 0,
    };
    try {
      if (novo)
        await api.createItem({
          ...corpo,
          ...(numero(f.initialQty) > 0
            ? { initialQty: numero(f.initialQty), initialExpiresOn: f.initialExpiresOn || null }
            : {}),
        });
      else await api.updateItem((item as StockItem).id, corpo);
      avisar(novo ? 'Material cadastrado' : 'Material salvo');
      aoSalvar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Gaveta
      aberta={item !== null}
      aoFechar={aoFechar}
      titulo={novo ? 'Novo material' : 'Editar material'}
      rodape={
        <Botao variante="principal" className="flex-1" onClick={salvar}>
          {novo ? 'Cadastrar material' : 'Salvar'}
        </Botao>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Nome">
          <Entrada
            value={f.name}
            maxLength={120}
            placeholder="Ex.: Anestésico lidocaína 2%"
            onChange={set('name')}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="Categoria">
            <Entrada
              value={f.category}
              maxLength={60}
              placeholder="Ex.: Anestesia"
              onChange={set('category')}
            />
          </Campo>
          <Campo rotulo="Fornecedor principal">
            <Seletor value={f.supplierId} onChange={set('supplierId')}>
              <option value="">Nenhum</option>
              {fornecedores.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Seletor>
          </Campo>
        </div>
        <fieldset className="rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
          <legend className="sr-only">Unidades</legend>
          <p className="text-sm font-semibold">Compra em uma unidade, usa em outra</p>
          <p className="mt-0.5 text-sm text-nevoa">
            Ex.: compra em caixa com 50 tubetes, usa por tubete. A entrada converte sozinha.
          </p>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-sm">
            <span className="text-nevoa">1</span>
            <span />
            <Seletor
              aria-label="Unidade de compra"
              value={f.purchaseUnit}
              onChange={set('purchaseUnit')}
            >
              {STOCK_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Seletor>
            <span className="px-1 text-nevoa">=</span>
            <Entrada
              aria-label="Quantas unidades de uso"
              inputMode="decimal"
              value={f.unitsPerPurchase}
              onChange={set('unitsPerPurchase')}
            />
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
            <span className="text-nevoa">Unidade de uso</span>
            <Seletor aria-label="Unidade de uso" value={f.unit} onChange={set('unit')}>
              {[...STOCK_UNITS, 'U'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Seletor>
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo={`Estoque mínimo (${f.unit})`}>
            <Entrada inputMode="decimal" value={f.minQty} onChange={set('minQty')} />
          </Campo>
          <Campo rotulo={`Custo por ${f.unit}`} ajuda="Atualiza sozinho a cada compra">
            <EntradaDinheiro valor={custo} aoMudar={setCusto} />
          </Campo>
        </div>
        <Campo
          rotulo="Validade depois de aberto (dias)"
          ajuda="Para frascos como toxina ou anestésico. Deixe vazio se não se aplica."
        >
          <Entrada
            inputMode="numeric"
            value={f.openValidityDays}
            onChange={set('openValidityDays')}
          />
        </Campo>
        {novo ? (
          <div className="grid grid-cols-2 gap-4">
            <Campo rotulo={`Já tem quanto? (${f.unit})`}>
              <Entrada inputMode="decimal" value={f.initialQty} onChange={set('initialQty')} />
            </Campo>
            <Campo rotulo="Validade desse saldo">
              <Entrada type="date" value={f.initialExpiresOn} onChange={set('initialExpiresOn')} />
            </Campo>
          </div>
        ) : null}
      </div>
    </Gaveta>
  );
}
