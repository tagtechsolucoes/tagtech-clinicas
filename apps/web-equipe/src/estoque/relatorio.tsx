import { useEffect, useState } from 'react';
import { api, type StockReport } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro, hoje } from '../formato';
import { Icone } from '../ui';

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const nomeMes = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-15T12:00:00Z`),
  );

/** Gasto com material, custo real por procedimento, perdas e preços que subiram. */
export function Relatorio() {
  const { avisar } = usePainel();
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [r, setR] = useState<StockReport | null>(null);
  useEffect(() => {
    api
      .stockReport(mes)
      .then(setR)
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, avisar]);

  const maior = Math.max(1, ...(r?.bySupplier.map((s) => s.totalCents) ?? [1]));
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMes(somarMes(mes, -1))}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
        >
          <Icone nome="esquerda" className="h-4 w-4" />
        </button>
        <h2 className="inline-block font-display text-xl first-letter:uppercase">{nomeMes(mes)}</h2>
        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => setMes(somarMes(mes, 1))}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
        >
          <Icone nome="direita" className="h-4 w-4" />
        </button>
      </div>
      {r ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
              <dt className="text-sm text-nevoa">Compras no mês</dt>
              <dd className="mt-1 font-display text-3xl tabular-nums">
                {dinheiro(r.purchasesCents)}
              </dd>
            </div>
            <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
              <dt className="text-sm text-nevoa">Usado nas consultas</dt>
              <dd className="mt-1 font-display text-3xl tabular-nums">
                {dinheiro(r.byProcedure.reduce((s, p) => s + p.costCents, 0))}
              </dd>
            </div>
            <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
              <dt className="text-sm text-nevoa">Perdas e vencidos</dt>
              <dd
                className={`mt-1 font-display text-3xl tabular-nums ${r.lossesCents ? 'text-alerta' : ''}`}
              >
                {dinheiro(r.lossesCents)}
              </dd>
            </div>
          </dl>

          {r.priceIncreases.length ? (
            <section className="rounded-2xl bg-ambar-fundo p-5">
              <h3 className="font-semibold text-ambar-tinta">Preços que subiram mais de 10%</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {r.priceIncreases.map((p) => (
                  <li key={`${p.name}${p.supplier}`}>
                    <strong>{p.name}</strong> na {p.supplier}: {dinheiro(p.fromCents)} →{' '}
                    {dinheiro(p.toCents)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">
                Compras por fornecedor
              </h3>
              {r.bySupplier.length ? (
                <ul className="space-y-3 rounded-2xl bg-folha p-5 ring-1 ring-linha">
                  {r.bySupplier.map((s) => (
                    <li key={s.name}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{s.name}</span>
                        <span className="tabular-nums">{dinheiro(s.totalCents)}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-trilho">
                        <div
                          className="h-full rounded-full bg-petroleo"
                          style={{ width: `${(s.totalCents / maior) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-nevoa">Nenhuma compra no mês.</p>
              )}
            </section>
            <section>
              <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">
                Lucro por procedimento (material × preço)
              </h3>
              {r.procedureMargins.length ? (
                <table className="w-full overflow-hidden rounded-2xl bg-folha text-sm ring-1 ring-linha">
                  <thead className="bg-porcelana text-left text-nevoa">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Procedimento</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Material</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Sobra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-linha">
                    {r.procedureMargins.map((p) => (
                      <tr key={p.serviceId}>
                        <td className="px-4 py-2.5 font-medium">{p.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {dinheiro(p.materialCents)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                          {p.marginCents === null ? '—' : dinheiro(p.marginCents)}
                          {p.priceCents ? (
                            <span className="ml-1.5 text-xs font-normal text-nevoa">
                              {Math.round(((p.marginCents ?? 0) / p.priceCents) * 100)}%
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-nevoa">
                  Ligue materiais aos serviços para ver o custo de cada procedimento.
                </p>
              )}
            </section>
          </div>
        </>
      ) : (
        <p className="text-nevoa">Carregando…</p>
      )}
    </div>
  );
}
