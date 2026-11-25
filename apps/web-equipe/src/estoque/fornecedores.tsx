import { useEffect, useState } from 'react';
import { api, type Supplier } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro, telefone } from '../formato';
import { Botao, Campo, Entrada, Gaveta, Icone, Texto, Vazio } from '../ui';

const vazio = { name: '', contact: '', whatsapp: '', email: '', leadTimeDays: '2', notes: '' };

/** Fornecedores: contato, prazo de entrega e último preço pago em cada material. */
export function Fornecedores({
  lista,
  aoMudar,
}: {
  lista: Supplier[];
  aoMudar: () => Promise<void>;
}) {
  const { avisar } = usePainel();
  const [aberto, setAberto] = useState<Supplier | 'novo' | null>(null);
  const [f, setF] = useState(vazio);

  useEffect(() => {
    if (aberto === 'novo') setF(vazio);
    else if (aberto)
      setF({
        name: aberto.name,
        contact: aberto.contact,
        whatsapp: aberto.whatsapp,
        email: aberto.email,
        leadTimeDays: String(aberto.leadTimeDays),
        notes: aberto.notes,
      });
  }, [aberto]);

  async function salvar() {
    const corpo = { ...f, leadTimeDays: Math.max(0, Math.min(90, Number(f.leadTimeDays) || 0)) };
    try {
      if (aberto === 'novo') await api.createSupplier(corpo);
      else if (aberto) await api.updateSupplier(aberto.id, corpo);
      avisar('Fornecedor salvo');
      setAberto(null);
      await aoMudar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const atual = aberto !== 'novo' ? aberto : null;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Botao variante="principal" onClick={() => setAberto('novo')}>
          <Icone nome="mais" className="h-4 w-4" /> Novo fornecedor
        </Botao>
      </div>
      {lista.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {lista.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setAberto(s)}
                className="h-full w-full rounded-2xl bg-folha p-5 text-left ring-1 ring-linha transition hover:ring-tinta/30"
              >
                <span className="block font-display text-xl">{s.name}</span>
                <span className="mt-1 block text-sm text-nevoa">
                  {[
                    s.contact,
                    s.whatsapp ? telefone(s.whatsapp) : null,
                    `entrega em ${s.leadTimeDays} dias úteis`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {s.prices?.length ? (
                  <span className="mt-3 block text-sm">
                    {s.prices.length} {s.prices.length === 1 ? 'material' : 'materiais'} com preço
                    registrado
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Vazio
          titulo="Nenhum fornecedor"
          texto="Com o WhatsApp e o prazo de entrega, a lista de compras já sai pronta para cada um."
        />
      )}

      <Gaveta
        aberta={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto === 'novo' ? 'Novo fornecedor' : (atual?.name ?? '')}
        rodape={
          <Botao variante="principal" className="flex-1" onClick={salvar}>
            Salvar
          </Botao>
        }
      >
        <div className="space-y-5">
          <Campo rotulo="Nome">
            <Entrada value={f.name} maxLength={120} onChange={set('name')} />
          </Campo>
          <div className="grid grid-cols-2 gap-4">
            <Campo rotulo="Contato">
              <Entrada
                value={f.contact}
                maxLength={120}
                placeholder="Nome do vendedor"
                onChange={set('contact')}
              />
            </Campo>
            <Campo rotulo="WhatsApp">
              <Entrada
                value={f.whatsapp}
                inputMode="tel"
                placeholder="(81) 99999-0000"
                onChange={set('whatsapp')}
              />
            </Campo>
            <Campo rotulo="E-mail">
              <Entrada type="email" value={f.email} onChange={set('email')} />
            </Campo>
            <Campo rotulo="Entrega (dias úteis)">
              <Entrada inputMode="numeric" value={f.leadTimeDays} onChange={set('leadTimeDays')} />
            </Campo>
          </div>
          <Campo rotulo="Observações">
            <Texto
              value={f.notes}
              maxLength={500}
              placeholder="Ex.: pedido até 14h sai no mesmo dia"
              onChange={set('notes')}
            />
          </Campo>
          {atual?.prices?.length ? (
            <section>
              <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Último preço pago</h3>
              <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
                {atual.prices.map((p) => {
                  const subiu =
                    p.previousPriceCents !== null && p.lastPriceCents > p.previousPriceCents;
                  return (
                    <li key={p.itemId} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex-1">{p.itemName}</span>
                      {p.previousPriceCents !== null &&
                      p.previousPriceCents !== p.lastPriceCents ? (
                        <span
                          className={`text-xs font-semibold ${subiu ? 'text-alerta' : 'text-ok'}`}
                        >
                          {subiu ? '▲' : '▼'}{' '}
                          {Math.abs(
                            Math.round(
                              ((p.lastPriceCents - p.previousPriceCents) / p.previousPriceCents) *
                                100,
                            ),
                          )}
                          %
                        </span>
                      ) : null}
                      <span className="font-semibold tabular-nums">
                        {dinheiro(p.lastPriceCents)}/{p.purchaseUnit}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </Gaveta>
    </>
  );
}
