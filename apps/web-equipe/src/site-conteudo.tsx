import { useEffect, useState, type ReactNode } from 'react';
import { SITE_LIMITS, type SiteContent } from '@tagtech/domain';
import { api, type SitePhoto } from './api';
import { mensagem, usePainel } from './contexto';
import { Botao, Campo, Entrada, Icone, Interruptor, Texto } from './ui';

/**
 * O que o site mostra além da identidade: números, diferenciais, fotos do espaço,
 * depoimentos, dúvidas, pagamento, horário e como chegar. Seção vazia não aparece no site.
 * As fotos são gravadas na hora; o resto vai junto com "Salvar alterações".
 */
export function ConteudoDoSite({
  valor,
  aoMudar,
  Secao,
}: {
  valor: SiteContent;
  aoMudar: (v: SiteContent) => void;
  Secao: (p: { titulo: string; descricao?: string; children: ReactNode }) => ReactNode;
}) {
  const v = valor;
  const muda = <K extends keyof SiteContent>(k: K, x: SiteContent[K]) => aoMudar({ ...v, [k]: x });

  return (
    <>
      <Secao
        titulo="Números e diferenciais"
        descricao="Aparecem no topo e no “Sobre” do site. Use só números verdadeiros."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => {
            const s = v.stats[i] ?? { value: '', label: '' };
            const troca = (n: typeof s) => {
              const lista = [0, 1, 2].map((j) =>
                j === i ? n : (v.stats[j] ?? { value: '', label: '' }),
              );
              muda(
                'stats',
                lista.filter((x) => x.value.trim()),
              );
            };
            return (
              <div key={i} className="space-y-2 rounded-2xl bg-porcelana p-3 ring-1 ring-linha">
                <Entrada
                  maxLength={12}
                  placeholder={['12 anos', '+2.400', '4 dentistas'][i]}
                  value={s.value}
                  onChange={(e) => troca({ ...s, value: e.target.value })}
                  className="font-semibold"
                />
                <Entrada
                  maxLength={40}
                  placeholder={
                    ['de consultório', 'pacientes atendidos', 'especialistas na equipe'][i]
                  }
                  value={s.label}
                  onChange={(e) => troca({ ...s, label: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <Lista
          itens={v.highlights}
          max={SITE_LIMITS.highlights}
          novo={{ title: '', text: '' }}
          aoMudar={(x) => muda('highlights', x)}
          rotuloNovo="Adicionar diferencial"
          render={(h, troca) => (
            <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <Entrada
                maxLength={40}
                placeholder="Hora marcada de verdade"
                value={h.title}
                onChange={(e) => troca({ ...h, title: e.target.value })}
                className="font-semibold"
              />
              <Entrada
                maxLength={140}
                placeholder="Atrasos acima de 10 minutos são avisados pelo WhatsApp."
                value={h.text}
                onChange={(e) => troca({ ...h, text: e.target.value })}
              />
            </div>
          )}
        />
      </Secao>

      <Secao
        titulo="Fotos do espaço"
        descricao="Recepção, consultório, equipamentos. As três primeiras entram no “Sobre”; todas aparecem na galeria do espaço."
      >
        <Fotos />
      </Secao>

      <Secao
        titulo="Depoimentos"
        descricao="Só depoimentos reais, com autorização por escrito do paciente para mostrar o nome e o texto. Sem promessa de resultado."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            rotulo="Nota média (Google, por exemplo)"
            ajuda="Deixe em branco para não mostrar."
          >
            <Entrada
              inputMode="decimal"
              placeholder="4,9"
              value={v.rating ? String(v.rating.value).replace('.', ',') : ''}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'));
                muda(
                  'rating',
                  e.target.value.trim() && n >= 1 && n <= 5
                    ? { value: Math.round(n * 10) / 10, count: v.rating?.count ?? 0 }
                    : null,
                );
              }}
            />
          </Campo>
          <Campo rotulo="Número de avaliações">
            <Entrada
              inputMode="numeric"
              placeholder="312"
              disabled={!v.rating}
              value={v.rating ? String(v.rating.count || '') : ''}
              onChange={(e) =>
                v.rating &&
                muda('rating', {
                  ...v.rating,
                  count: Math.min(1_000_000, Number(e.target.value.replace(/\D/g, '')) || 0),
                })
              }
            />
          </Campo>
        </div>
        <Lista
          itens={v.testimonials}
          max={SITE_LIMITS.testimonials}
          novo={{ name: '', text: '', service: '' }}
          aoMudar={(x) => muda('testimonials', x)}
          rotuloNovo="Adicionar depoimento"
          render={(t, troca) => (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Entrada
                  maxLength={60}
                  placeholder="Nome do paciente"
                  value={t.name}
                  onChange={(e) => troca({ ...t, name: e.target.value })}
                  className="font-semibold"
                />
                <Entrada
                  maxLength={60}
                  placeholder="Tratamento (opcional)"
                  value={t.service}
                  onChange={(e) => troca({ ...t, service: e.target.value })}
                />
              </div>
              <Texto
                rows={2}
                maxLength={400}
                placeholder="O que o paciente disse"
                value={t.text}
                onChange={(e) => troca({ ...t, text: e.target.value })}
              />
            </div>
          )}
        />
      </Secao>

      <Secao titulo="Dúvidas frequentes" descricao="A primeira já aparece aberta no site.">
        <Lista
          itens={v.faq}
          max={SITE_LIMITS.faq}
          novo={{ question: '', answer: '' }}
          aoMudar={(x) => muda('faq', x)}
          rotuloNovo="Adicionar pergunta"
          render={(f, troca) => (
            <div className="space-y-2">
              <Entrada
                maxLength={160}
                placeholder="Vocês atendem crianças?"
                value={f.question}
                onChange={(e) => troca({ ...f, question: e.target.value })}
                className="font-semibold"
              />
              <Texto
                rows={2}
                maxLength={600}
                placeholder="Resposta"
                value={f.answer}
                onChange={(e) => troca({ ...f, answer: e.target.value })}
              />
            </div>
          )}
        />
      </Secao>

      <Secao
        titulo="Valores no site"
        descricao="Cada conselho tem regra própria para anunciar preço. Na dúvida, esconda: o paciente vê o valor na consulta ou pelo WhatsApp."
      >
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ['hide', 'Esconder valores', 'Mostra só o serviço e a duração'],
              ['from', 'A partir de', '“a partir de R$ 120,00”'],
              ['show', 'Mostrar valores', 'O valor particular de cada serviço'],
            ] as const
          ).map(([k, t, d]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={v.prices === k}
              onClick={() => muda('prices', k)}
              className={`rounded-2xl px-4 py-3 text-left ring-1 transition ${v.prices === k ? 'bg-agua ring-2 ring-petroleo' : 'bg-folha ring-linha hover:ring-petroleo/40'}`}
            >
              <span className="block font-semibold">{t}</span>
              <span className="text-sm text-nevoa">{d}</span>
            </button>
          ))}
        </div>
        <div className="rounded-2xl bg-ambar-fundo px-4 py-3 text-sm text-ambar-tinta">
          <b>Odontologia:</b> o Código de Ética do CFO (art. 44, I) proíbe anunciar preços e formas
          de pagamento. <b>Medicina:</b> a Resolução CFM 2.336/2023 permite divulgar o valor da
          consulta. Outras áreas: confira com o conselho da profissão.
        </div>
      </Secao>

      <Secao
        titulo="Pagamento"
        descricao="Os planos aceitos entram sozinhos, a partir dos convênios marcados para aparecer no site. Formas de pagamento seguem a mesma regra de conselho dos valores."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['pix', 'Pix'],
              ['credit', 'Cartão de crédito'],
              ['debit', 'Cartão de débito'],
              ['cash', 'Dinheiro'],
            ] as const
          ).map(([k, t]) => (
            <div key={k} className="rounded-2xl bg-porcelana px-4 py-3 ring-1 ring-linha">
              <Interruptor
                rotulo={t}
                ligado={v.payments[k]}
                aoMudar={(x) => muda('payments', { ...v.payments, [k]: x })}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Desconto no Pix (%)">
            <Entrada
              inputMode="numeric"
              disabled={!v.payments.pix}
              value={v.payments.pixDiscountPct || ''}
              placeholder="0"
              onChange={(e) =>
                muda('payments', {
                  ...v.payments,
                  pixDiscountPct: Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 0),
                })
              }
            />
          </Campo>
          <Campo rotulo="Parcelas no crédito">
            <Entrada
              inputMode="numeric"
              disabled={!v.payments.credit}
              value={v.payments.installments}
              onChange={(e) =>
                muda('payments', {
                  ...v.payments,
                  installments: Math.min(
                    24,
                    Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1),
                  ),
                })
              }
            />
          </Campo>
        </div>
        <Campo rotulo="Observação">
          <Entrada
            maxLength={200}
            placeholder="Seu plano não está na lista? Emitimos nota para reembolso."
            value={v.payments.note}
            onChange={(e) => muda('payments', { ...v.payments, note: e.target.value })}
          />
        </Campo>
      </Secao>

      <Secao titulo="Horário e como chegar" descricao="O endereço vem da unidade, mais acima.">
        <Lista
          itens={v.hours}
          max={SITE_LIMITS.hours}
          novo={{ days: '', hours: '' }}
          aoMudar={(x) => muda('hours', x)}
          rotuloNovo="Adicionar horário"
          render={(h, troca) => (
            <div className="grid grid-cols-2 gap-2">
              <Entrada
                maxLength={30}
                placeholder="Segunda a sexta"
                value={h.days}
                onChange={(e) => troca({ ...h, days: e.target.value })}
              />
              <Entrada
                maxLength={40}
                placeholder="8h às 19h"
                value={h.hours}
                onChange={(e) => troca({ ...h, hours: e.target.value })}
              />
            </div>
          )}
        />
        <Lista
          itens={v.arrival}
          max={SITE_LIMITS.arrival}
          novo=""
          aoMudar={(x) => muda('arrival', x)}
          rotuloNovo="Adicionar informação de acesso"
          render={(a, troca) => (
            <Entrada
              maxLength={80}
              placeholder="Estacionamento conveniado no prédio"
              value={a}
              onChange={(e) => troca(e.target.value)}
            />
          )}
        />
      </Secao>
    </>
  );
}

/** Lista editável com adicionar e remover, até um máximo. */
function Lista<T>({
  itens,
  max,
  novo,
  aoMudar,
  render,
  rotuloNovo,
}: {
  itens: T[];
  max: number;
  novo: T;
  aoMudar: (x: T[]) => void;
  render: (item: T, troca: (n: T) => void) => ReactNode;
  rotuloNovo: string;
}) {
  return (
    <div className="space-y-2.5">
      {itens.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {render(item, (n) => aoMudar(itens.map((x, j) => (j === i ? n : x))))}
          </div>
          <button
            type="button"
            aria-label="Remover"
            onClick={() => aoMudar(itens.filter((_, j) => j !== i))}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-bruma hover:bg-alerta/10 hover:text-alerta"
          >
            <Icone nome="x" className="h-4 w-4" />
          </button>
        </div>
      ))}
      {itens.length < max ? (
        <Botao tamanho="pequeno" variante="discreto" onClick={() => aoMudar([...itens, novo])}>
          <Icone nome="mais" className="h-4 w-4" /> {rotuloNovo}
        </Botao>
      ) : null}
    </div>
  );
}

function Fotos() {
  const { avisar } = usePainel();
  const [fotos, setFotos] = useState<SitePhoto[] | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.sitePhotos().then(setFotos, (e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);

  async function rodar(fn: () => Promise<SitePhoto[]>, ok?: string) {
    try {
      setFotos(await fn());
      if (ok) avisar(ok);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  async function enviar(files: FileList) {
    setEnviando(true);
    for (const f of Array.from(files)) await rodar(() => api.addSitePhoto(f));
    setEnviando(false);
  }

  /** Troca a foto de lugar com a vizinha e grava a ordem nova. */
  async function mover(i: number, d: -1 | 1) {
    if (!fotos) return;
    const nova = [...fotos];
    const [a] = nova.splice(i, 1);
    nova.splice(i + d, 0, a!);
    setFotos(nova);
    try {
      for (const [pos, f] of nova.entries()) await api.updateSitePhoto(f.id, { position: pos });
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  if (!fotos) return <p className="text-sm text-bruma">Carregando fotos…</p>;
  return (
    <div className="space-y-4">
      {fotos.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {fotos.map((f, i) => (
            <li key={f.id} className="overflow-hidden rounded-2xl bg-folha ring-1 ring-linha">
              <div className="relative aspect-[4/3] bg-porcelana">
                <img src={`/api${f.url}`} alt="" className="h-full w-full object-cover" />
                <div className="absolute top-2 right-2 flex gap-1">
                  {i > 0 ? (
                    <BotaoFoto
                      rotulo="Mover para antes"
                      icone="esquerda"
                      onClick={() => mover(i, -1)}
                    />
                  ) : null}
                  {i < fotos.length - 1 ? (
                    <BotaoFoto
                      rotulo="Mover para depois"
                      icone="direita"
                      onClick={() => mover(i, 1)}
                    />
                  ) : null}
                  <BotaoFoto
                    rotulo="Remover foto"
                    icone="x"
                    onClick={() => rodar(() => api.removeSitePhoto(f.id), 'Foto removida')}
                  />
                </div>
              </div>
              <div className="space-y-2 p-3">
                <Entrada
                  maxLength={40}
                  placeholder="Título (ex.: Recepção)"
                  defaultValue={f.title}
                  onBlur={(e) =>
                    e.target.value !== f.title &&
                    rodar(() => api.updateSitePhoto(f.id, { title: e.target.value }))
                  }
                  className="h-9 text-sm font-semibold"
                />
                <Entrada
                  maxLength={80}
                  placeholder="Legenda (opcional)"
                  defaultValue={f.caption}
                  onBlur={(e) =>
                    e.target.value !== f.caption &&
                    rodar(() => api.updateSitePhoto(f.id, { caption: e.target.value }))
                  }
                  className="h-9 text-sm"
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {fotos.length < 12 ? (
        <label
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-linha px-4 py-6 text-sm font-semibold text-petroleo hover:border-petroleo/40 ${enviando ? 'pointer-events-none opacity-60' : ''}`}
        >
          <Icone nome="upload" className="h-5 w-5" />
          {enviando ? 'Enviando…' : 'Enviar fotos do espaço'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void enviar(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function BotaoFoto({
  rotulo,
  icone,
  onClick,
}: {
  rotulo: string;
  icone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-tinta shadow hover:bg-white"
    >
      <Icone nome={icone} className="h-4 w-4" />
    </button>
  );
}
