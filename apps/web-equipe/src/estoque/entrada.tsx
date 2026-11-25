import { useEffect, useState } from 'react';
import { PAY_METHOD_LABELS, PAY_METHODS, type PayMethod } from '@tagtech/domain';
import { api, type StockItem, type Supplier } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro, hoje } from '../formato';
import { Botao, Campo, Entrada as Campo_, EntradaDinheiro, Gaveta, Icone, Seletor } from '../ui';
import { qtd } from './comum';

export interface Prefill {
  supplierId?: string | null;
  orderId?: string;
  items?: Array<{ itemId: string; purchaseQty: number; priceCents?: number }>;
}

interface Linha {
  itemId: string;
  purchaseQty: string;
  price: number | null;
  lot: string;
  expiresOn: string;
}

const numero = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Entrada de compra: soma no estoque com lote e validade e lança a conta a pagar. */
export function Entrada({
  prefill,
  itens,
  fornecedores,
  aoFechar,
  aoSalvar,
}: {
  prefill: Prefill | null;
  itens: StockItem[];
  fornecedores: Supplier[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { avisar } = usePainel();
  const [supplierId, setSupplierId] = useState('');
  const [nota, setNota] = useState('');
  const [dia, setDia] = useState(hoje());
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [conta, setConta] = useState<'aberta' | PayMethod | 'nao'>('aberta');
  const [vence, setVence] = useState(somaDias(hoje(), 30));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setSupplierId(prefill.supplierId ?? '');
    setNota('');
    setDia(hoje());
    setConta('aberta');
    setVence(somaDias(hoje(), 30));
    setLinhas(
      (prefill.items ?? []).map((i) => ({
        itemId: i.itemId,
        purchaseQty: String(i.purchaseQty),
        price: i.priceCents ?? null,
        lot: '',
        expiresOn: '',
      })),
    );
  }, [prefill]);

  const ultimo = (itemId: string) =>
    fornecedores.find((f) => f.id === supplierId)?.prices?.find((p) => p.itemId === itemId)
      ?.lastPriceCents ?? null;
  const total = linhas.reduce((s, l) => s + Math.round(numero(l.purchaseQty) * (l.price ?? 0)), 0);
  const set = (i: number, patch: Partial<Linha>) =>
    setLinhas(linhas.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function salvar() {
    const validas = linhas.filter((l) => l.itemId && numero(l.purchaseQty) > 0);
    if (!validas.length) return avisar('Inclua ao menos um material com quantidade', 'erro');
    setSalvando(true);
    try {
      const r = await api.stockPurchase({
        supplierId: supplierId || null,
        invoice: nota.trim(),
        receivedOn: dia,
        items: validas.map((l) => ({
          itemId: l.itemId,
          purchaseQty: numero(l.purchaseQty),
          unitPriceCents: l.price ?? 0,
          lot: l.lot.trim(),
          expiresOn: l.expiresOn || null,
        })),
        ...(conta === 'nao'
          ? {}
          : {
              expense: {
                dueDate: conta === 'aberta' ? vence : dia,
                ...(conta !== 'aberta' ? { paid: { method: conta } } : {}),
              },
            }),
        ...(prefill?.orderId ? { orderId: prefill.orderId } : {}),
      });
      avisar(
        r.priceAlerts.length
          ? `Entrada lançada. Atenção: ${r.priceAlerts[0]!.name} subiu de ${dinheiro(r.priceAlerts[0]!.fromCents)} para ${dinheiro(r.priceAlerts[0]!.toCents)}`
          : 'Entrada lançada no estoque',
      );
      aoSalvar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      aberta={prefill !== null}
      aoFechar={aoFechar}
      titulo="Entrada de compra"
      subtitulo={
        prefill?.orderId
          ? 'Recebendo um pedido feito pela lista de compras'
          : 'O material entra no estoque com lote e validade'
      }
      rodape={
        <Botao variante="principal" className="flex-1" disabled={salvando} onClick={salvar}>
          Lançar entrada · {dinheiro(total)}
        </Botao>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="Fornecedor">
            <Seletor value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Sem fornecedor</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Nota fiscal">
            <Campo_
              value={nota}
              maxLength={60}
              placeholder="Número"
              onChange={(e) => setNota(e.target.value)}
            />
          </Campo>
        </div>
        <Campo rotulo="Recebido em">
          <Campo_ type="date" value={dia} max={hoje()} onChange={(e) => setDia(e.target.value)} />
        </Campo>

        <section>
          <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Materiais</h3>
          <ul className="space-y-3">
            {linhas.map((l, i) => {
              const it = itens.find((x) => x.id === l.itemId);
              return (
                <li key={i} className="rounded-2xl bg-porcelana p-3.5 ring-1 ring-linha">
                  <div className="flex gap-2">
                    <Seletor
                      aria-label="Material"
                      value={l.itemId}
                      onChange={(e) =>
                        set(i, { itemId: e.target.value, price: ultimo(e.target.value) ?? l.price })
                      }
                    >
                      <option value="">Escolha o material</option>
                      {itens.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Seletor>
                    <button
                      type="button"
                      aria-label="Tirar linha"
                      onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-nevoa hover:bg-tinta/5 hover:text-alerta"
                    >
                      <Icone nome="x" className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Campo rotulo={`Quantidade (${it?.purchaseUnit ?? 'unidade'})`}>
                      <Campo_
                        inputMode="decimal"
                        value={l.purchaseQty}
                        onChange={(e) => set(i, { purchaseQty: e.target.value })}
                      />
                    </Campo>
                    <Campo rotulo={`Preço por ${it?.purchaseUnit ?? 'unidade'}`}>
                      <EntradaDinheiro valor={l.price} aoMudar={(c) => set(i, { price: c })} />
                    </Campo>
                    <Campo rotulo="Lote">
                      <Campo_
                        value={l.lot}
                        maxLength={60}
                        onChange={(e) => set(i, { lot: e.target.value })}
                      />
                    </Campo>
                    <Campo rotulo="Validade">
                      <Campo_
                        type="date"
                        value={l.expiresOn}
                        onChange={(e) => set(i, { expiresOn: e.target.value })}
                      />
                    </Campo>
                  </div>
                  {it && it.unitsPerPurchase !== 1 && numero(l.purchaseQty) > 0 ? (
                    <p className="mt-2 text-sm text-nevoa">
                      Entram {qtd(numero(l.purchaseQty) * it.unitsPerPurchase, it.unit)} no estoque.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Botao
            className="mt-3"
            onClick={() =>
              setLinhas([
                ...linhas,
                { itemId: '', purchaseQty: '1', price: null, lot: '', expiresOn: '' },
              ])
            }
          >
            <Icone nome="mais" className="h-4 w-4" /> Material
          </Botao>
        </section>

        <section className="rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
          <h3 className="font-semibold">No financeiro</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Seletor
              aria-label="Conta a pagar"
              value={conta}
              onChange={(e) => setConta(e.target.value as typeof conta)}
            >
              <option value="aberta">Lançar conta a pagar</option>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>
                  Já paga em {PAY_METHOD_LABELS[m].toLowerCase()}
                </option>
              ))}
              <option value="nao">Não lançar</option>
            </Seletor>
            {conta === 'aberta' ? (
              <Campo_
                type="date"
                aria-label="Vencimento"
                value={vence}
                onChange={(e) => setVence(e.target.value)}
              />
            ) : null}
          </div>
        </section>
      </div>
    </Gaveta>
  );
}
