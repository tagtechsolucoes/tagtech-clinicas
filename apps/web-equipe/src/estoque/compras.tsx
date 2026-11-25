import { useCallback, useEffect, useState } from 'react';
import { SHOPPING_REASONS, whatsappLink } from '@tagtech/domain';
import { api, type ShoppingGroup, type StockItem, type Supplier } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dinheiro } from '../formato';
import { Botao, Entrada, Icone, Vazio } from '../ui';
import { qtd } from './comum';
import type { Prefill } from './entrada';

const COR = {
  agenda: 'bg-alerta-fundo text-alerta',
  minimum: 'bg-ambar-fundo text-ambar-tinta',
  ending: 'bg-ambar-fundo text-ambar-tinta',
  expiring: 'bg-azul-fundo text-azul',
} as const;

type Pedido = Awaited<ReturnType<typeof api.orders>>[number];

/** Lista de compras automática, separada por fornecedor, com pedido pronto para o WhatsApp. */
export function Compras({
  fornecedores,
  itens,
  aoReceber,
  aoMudar,
}: {
  fornecedores: Supplier[];
  itens: StockItem[];
  aoReceber: (p: Prefill) => void;
  aoMudar: () => Promise<void>;
}) {
  const { avisar, clinic } = usePainel();
  const [grupos, setGrupos] = useState<ShoppingGroup[] | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [qtds, setQtds] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([api.shopping(), api.orders()]);
      setGrupos(g);
      setPedidos(p);
      setQtds(
        Object.fromEntries(
          g.flatMap((x) => x.items.map((i) => [i.itemId, String(i.suggestedQty)])),
        ),
      );
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }, [avisar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const n = (id: string) => Math.max(0, Number((qtds[id] ?? '0').replace(',', '.')) || 0);

  function mensagemPedido(g: ShoppingGroup) {
    const linhas = g.items
      .filter((i) => n(i.itemId) > 0)
      .map((i) => `• ${qtd(n(i.itemId), i.purchaseUnit)} de ${i.name}`)
      .join('\n');
    return `Olá${g.supplier?.contact ? `, ${g.supplier.contact.split(' ')[0]}` : ''}! Aqui é da ${clinic.name}. Gostaria de fazer um pedido:\n\n${linhas}\n\nPode me confirmar valor e prazo de entrega? Obrigado!`;
  }

  async function marcarPedido(g: ShoppingGroup) {
    const items = g.items
      .filter((i) => n(i.itemId) > 0)
      .map((i) => ({ itemId: i.itemId, purchaseQty: n(i.itemId) }));
    if (!items.length) return;
    try {
      await api.createOrder(g.supplier?.id ?? null, items);
      avisar('Pedido registrado. Ao chegar, dê entrada por ele.');
      await Promise.all([carregar(), aoMudar()]);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  if (!grupos) return <p className="text-nevoa">Carregando…</p>;

  return (
    <div className="space-y-8">
      {pedidos.length ? (
        <section>
          <h2 className="mb-3 font-display text-xl">Pedidos a caminho</h2>
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {pedidos.map((p) => {
              const f = fornecedores.find((x) => x.id === p.supplierId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{f?.name ?? 'Sem fornecedor'}</span>
                    <span className="text-sm text-nevoa">
                      {p.items
                        .map((i) => {
                          const it = itens.find((x) => x.id === i.itemId);
                          return `${qtd(i.purchaseQty, it?.purchaseUnit)} ${it?.name ?? ''}`;
                        })
                        .join(' · ')}{' '}
                      · pedido {dataCurta(p.createdAt.slice(0, 10))}
                    </span>
                  </span>
                  <Botao
                    tamanho="pequeno"
                    variante="discreto"
                    onClick={() =>
                      api
                        .cancelOrder(p.id)
                        .then(() => Promise.all([carregar(), aoMudar()]))
                        .catch((e) => avisar(mensagem(e), 'erro'))
                    }
                  >
                    Cancelar
                  </Botao>
                  <Botao
                    tamanho="pequeno"
                    variante="principal"
                    onClick={() =>
                      aoReceber({
                        supplierId: p.supplierId,
                        orderId: p.id,
                        items: p.items.map((i) => ({
                          ...i,
                          ...(f?.prices?.find((x) => x.itemId === i.itemId)
                            ? {
                                priceCents: f.prices.find((x) => x.itemId === i.itemId)!
                                  .lastPriceCents,
                              }
                            : {}),
                        })),
                      })
                    }
                  >
                    Chegou: dar entrada
                  </Botao>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {grupos.length ? (
        grupos.map((g) => {
          const total = g.items.reduce((s, i) => s + n(i.itemId) * i.priceCents, 0);
          return (
            <section
              key={g.supplier?.id ?? 'sem'}
              className="overflow-hidden rounded-3xl bg-folha ring-1 ring-linha"
            >
              <header className="flex flex-wrap items-center gap-3 border-b border-linha px-6 py-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-xl">
                    {g.supplier?.name ?? 'Sem fornecedor definido'}
                  </h2>
                  <p className="text-sm text-nevoa">
                    {g.supplier
                      ? `Entrega em ${g.supplier.leadTimeDays} dias úteis`
                      : 'Defina o fornecedor principal no material'}
                    {g.supplier?.notes ? ` · ${g.supplier.notes}` : ''}
                  </p>
                </div>
                <p className="text-right">
                  <span className="block text-xs text-nevoa">Total estimado</span>
                  <span className="font-semibold tabular-nums">{dinheiro(total)}</span>
                </p>
              </header>
              <ul className="divide-y divide-linha">
                {g.items.map((i) => (
                  <li
                    key={i.itemId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-6 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{i.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {i.reasons.map((r) => (
                          <span
                            key={r}
                            className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${COR[r]}`}
                          >
                            {SHOPPING_REASONS[r].label}
                            {r === 'agenda' && i.shortage
                              ? ` (${dataCurta(i.shortage.startsAt.slice(0, 10))})`
                              : ''}
                          </span>
                        ))}
                        <span className="text-xs text-nevoa">tem {qtd(i.qty, i.unit)}</span>
                      </span>
                    </span>
                    <label className="flex items-center gap-2 text-sm text-nevoa">
                      <span className="block w-20">
                        <Entrada
                          aria-label={`Quantidade de ${i.name}`}
                          inputMode="decimal"
                          value={qtds[i.itemId] ?? ''}
                          onChange={(e) => setQtds({ ...qtds, [i.itemId]: e.target.value })}
                          className="text-right tabular-nums"
                        />
                      </span>
                      {i.purchaseUnit}
                    </label>
                    <span className="hidden w-28 text-right tabular-nums sm:block">
                      {dinheiro(n(i.itemId) * i.priceCents)}
                    </span>
                  </li>
                ))}
              </ul>
              <footer className="flex flex-wrap justify-end gap-2 bg-porcelana px-6 py-4">
                {g.supplier?.whatsapp ? (
                  <a
                    href={whatsappLink(g.supplier.whatsapp, mensagemPedido(g))}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-folha px-4 font-semibold ring-1 ring-linha hover:ring-tinta/35"
                  >
                    <Icone nome="whatsapp" className="h-4 w-4" /> Pedir no WhatsApp
                  </a>
                ) : (
                  <Botao
                    onClick={() => {
                      void navigator.clipboard.writeText(mensagemPedido(g));
                      avisar('Pedido copiado');
                    }}
                  >
                    <Icone nome="copiar" className="h-4 w-4" /> Copiar pedido
                  </Botao>
                )}
                <Botao variante="principal" onClick={() => marcarPedido(g)}>
                  Marcar como pedido
                </Botao>
              </footer>
            </section>
          );
        })
      ) : (
        <Vazio
          titulo="Nada para comprar agora"
          texto="Quando algo for faltar para a agenda, ficar abaixo do mínimo ou perto de vencer, aparece aqui."
        />
      )}
    </div>
  );
}
