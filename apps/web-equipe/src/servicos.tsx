import { useEffect, useState } from 'react';
import { centsToInput, parseBRL } from '@tagtech/domain';
import { api, type Service, type StockItem } from './api';
import { mensagem, usePainel } from './contexto';
import { dinheiro, duracao } from './formato';
import { CORES } from './profissionais';
import {
  Avatar,
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  Gaveta,
  Icone,
  Interruptor,
  Seletor,
  Texto,
  Vazio,
} from './ui';

const DURACOES = [15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];

export function ServicosTela() {
  const { services, professionals } = usePainel();
  const [aberto, setAberto] = useState<Service | 'novo' | null>(null);
  const categorias = [...new Set(services.map((s) => s.category || 'Sem categoria'))];
  const nomePro = (id: string) => professionals.find((p) => p.id === id);

  return (
    <>
      <Cabecalho
        titulo="Serviços"
        descricao="O que a clínica oferece, quanto tempo leva e quem faz. A duração define o tamanho do horário na agenda."
        acoes={
          <Botao variante="principal" onClick={() => setAberto('novo')}>
            <Icone nome="mais" className="h-4 w-4" /> Novo serviço
          </Botao>
        }
      />
      {services.length === 0 ? (
        <Vazio
          titulo="Nenhum serviço ainda"
          texto="Comece pela consulta ou avaliação, que é o que o paciente novo mais procura."
        />
      ) : (
        <div className="space-y-8">
          {categorias.map((cat) => (
            <section key={cat}>
              <h2 className="mb-3 text-xl font-semibold">{cat}</h2>
              <ul className="divide-y divide-linha overflow-hidden rounded-2xl bg-folha ring-1 ring-linha">
                {services
                  .filter((s) => (s.category || 'Sem categoria') === cat)
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setAberto(s)}
                        className={`flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-porcelana ${s.active ? '' : 'opacity-55'}`}
                      >
                        <span
                          className="h-9 w-1.5 shrink-0 rounded-full"
                          style={{ background: s.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {s.name}
                            {!s.active ? (
                              <span className="ml-2 text-xs font-medium text-nevoa">inativo</span>
                            ) : null}
                          </span>
                          <span className="block text-sm text-nevoa">
                            {duracao(s.durationMinutes)}
                            {s.onlineBooking ? '' : ' · só pela recepção'}
                          </span>
                        </span>
                        <span className="hidden -space-x-2 sm:flex">
                          {(s.professionalIds.length ? s.professionalIds : [])
                            .slice(0, 4)
                            .map((id) => {
                              const p = nomePro(id);
                              return p ? (
                                <Avatar
                                  key={id}
                                  nome={p.name}
                                  cor={p.color}
                                  foto={p.photoUrl}
                                  tamanho="h-7 w-7 text-[0.6rem] ring-2 ring-folha"
                                />
                              ) : null;
                            })}
                          {s.professionalIds.length === 0 ? (
                            <span className="text-xs text-bruma">Todos</span>
                          ) : null}
                        </span>
                        <span className="w-28 text-right font-semibold tabular-nums">
                          {dinheiro(s.priceCents)}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Gaveta
        aberta={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto === 'novo' ? 'Novo serviço' : (aberto?.name ?? '')}
      >
        {aberto ? (
          <Formulario
            key={aberto === 'novo' ? 'novo' : aberto.id}
            s={aberto === 'novo' ? null : aberto}
            aoFechar={() => setAberto(null)}
          />
        ) : null}
      </Gaveta>
    </>
  );
}

function Formulario({ s, aoFechar }: { s: Service | null; aoFechar: () => void }) {
  const { professionals, services, recarregar, avisar } = usePainel();
  const [dados, setDados] = useState({
    name: s?.name ?? '',
    category: s?.category ?? '',
    description: s?.description ?? '',
    durationMinutes: s?.durationMinutes ?? 30,
    preco: s?.priceCents != null ? centsToInput(s.priceCents) : '',
    returnDays: s?.returnDays ?? null,
    telehealth: s?.telehealth ?? false,
    color: s?.color ?? CORES[0]!,
    onlineBooking: s?.onlineBooking ?? true,
    active: s?.active ?? true,
    professionalIds: s?.professionalIds ?? [],
  });
  const precoCents = dados.preco.trim() === '' ? null : parseBRL(dados.preco);
  // Ficha de materiais: o que o procedimento consome (sai do estoque ao finalizar).
  const [itens, setItens] = useState<StockItem[]>([]);
  const [mats, setMats] = useState<Array<{ itemId: string; qty: string }>>([]);
  const [matsMudou, setMatsMudou] = useState(false);
  useEffect(() => {
    api
      .stock()
      .then(setItens)
      .catch(() => setItens([]));
    if (s)
      api
        .serviceMaterials(s.id)
        .then((l) =>
          setMats(l.map((m) => ({ itemId: m.itemId, qty: String(m.qty).replace('.', ',') }))),
        )
        .catch(() => undefined);
  }, [s]);
  const num = (v: string) => Number(v.replace(',', '.')) || 0;
  const custoMaterial = Math.round(
    mats.reduce(
      (t, m) => t + num(m.qty) * (itens.find((i) => i.id === m.itemId)?.costCents ?? 0),
      0,
    ),
  );
  const categorias = [...new Set(services.map((x) => x.category).filter(Boolean))];

  async function salvar() {
    const { preco: _p, ...resto } = dados;
    const corpo = { ...resto, priceCents: precoCents };
    try {
      const salvo = s ? await api.updateService(s.id, corpo) : await api.createService(corpo);
      if (matsMudou)
        await api.setServiceMaterials(
          salvo.id,
          mats
            .filter((m) => m.itemId && num(m.qty) > 0)
            .map((m) => ({ itemId: m.itemId, qty: num(m.qty) })),
        );
      await recarregar();
      avisar('Serviço salvo');
      aoFechar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <div className="space-y-5">
      <Campo rotulo="Nome">
        <Entrada
          value={dados.name}
          onChange={(e) => setDados({ ...dados, name: e.target.value })}
          placeholder="Ex.: Limpeza e profilaxia"
        />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Duração">
          <Seletor
            value={dados.durationMinutes}
            onChange={(e) => setDados({ ...dados, durationMinutes: Number(e.target.value) })}
          >
            {[...new Set([...DURACOES, dados.durationMinutes])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {duracao(d)}
                </option>
              ))}
          </Seletor>
        </Campo>
        <Campo
          rotulo="Preço"
          ajuda={
            dados.preco.trim() === ''
              ? 'Vazio: “sob avaliação” no site.'
              : precoCents === null
                ? 'Valor inválido.'
                : undefined
          }
        >
          <Entrada
            inputMode="decimal"
            value={dados.preco}
            onChange={(e) => setDados({ ...dados, preco: e.target.value })}
            placeholder="R$ 0,00"
          />
        </Campo>
      </div>
      <Campo
        rotulo="Lembrete de retorno"
        ajuda="O paciente recebe no WhatsApp um convite para voltar, com o link para agendar."
      >
        <Seletor
          value={dados.returnDays ?? ''}
          onChange={(e) =>
            setDados({ ...dados, returnDays: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">Sem lembrete</option>
          {[...new Set([15, 30, 60, 90, 180, 365, ...(dados.returnDays ? [dados.returnDays] : [])])]
            .sort((a, b) => a - b)
            .map((d) => (
              <option key={d} value={d}>
                {d < 60
                  ? `${d} dias depois`
                  : d === 365
                    ? '1 ano depois'
                    : `${d / 30} meses depois`}
              </option>
            ))}
        </Seletor>
      </Campo>
      <Campo rotulo="Categoria">
        <Entrada
          list="categorias"
          value={dados.category}
          onChange={(e) => setDados({ ...dados, category: e.target.value })}
          placeholder="Ex.: Prevenção, Estética"
        />
        <datalist id="categorias">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Campo>
      <Campo rotulo="Descrição para o site">
        <Texto
          rows={2}
          maxLength={500}
          value={dados.description}
          onChange={(e) => setDados({ ...dados, description: e.target.value })}
        />
      </Campo>
      <div>
        <span className="mb-2 block text-[0.82rem] font-semibold text-nevoa">Quem faz</span>
        <div className="space-y-1.5">
          {professionals
            .filter((p) => p.active)
            .map((p) => {
              const marcado = dados.professionalIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-porcelana"
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() =>
                      setDados({
                        ...dados,
                        professionalIds: marcado
                          ? dados.professionalIds.filter((x) => x !== p.id)
                          : [...dados.professionalIds, p.id],
                      })
                    }
                    className="h-4 w-4 accent-petroleo"
                  />
                  <Avatar
                    nome={p.name}
                    cor={p.color}
                    foto={p.photoUrl}
                    tamanho="h-7 w-7 text-[0.6rem]"
                  />
                  {p.name}
                </label>
              );
            })}
        </div>
        <p className="mt-1.5 text-[0.8rem] text-bruma">
          Sem ninguém marcado, qualquer profissional pode fazer.
        </p>
      </div>
      {itens.length ? (
        <div>
          <span className="mb-1 block text-[0.82rem] font-semibold text-nevoa">
            Materiais do procedimento
          </span>
          <p className="mb-2 text-[0.8rem] text-bruma">
            Saem do estoque sozinhos quando a consulta é finalizada.
          </p>
          <ul className="space-y-2">
            {mats.map((m, i) => {
              const it = itens.find((x) => x.id === m.itemId);
              return (
                <li key={i} className="flex items-center gap-2">
                  <Seletor
                    aria-label="Material"
                    value={m.itemId}
                    onChange={(e) => {
                      setMats(mats.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)));
                      setMatsMudou(true);
                    }}
                  >
                    <option value="">Escolha</option>
                    {itens.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Seletor>
                  <span className="block w-20 shrink-0">
                    <Entrada
                      aria-label="Quantidade"
                      inputMode="decimal"
                      value={m.qty}
                      onChange={(e) => {
                        setMats(mats.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                        setMatsMudou(true);
                      }}
                      className="text-right"
                    />
                  </span>
                  <span className="w-14 shrink-0 text-sm text-nevoa">{it?.unit ?? ''}</span>
                  <button
                    type="button"
                    aria-label="Tirar material"
                    onClick={() => {
                      setMats(mats.filter((_, j) => j !== i));
                      setMatsMudou(true);
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-nevoa hover:text-alerta"
                  >
                    <Icone nome="x" className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between">
            <Botao
              tamanho="pequeno"
              onClick={() => {
                setMats([...mats, { itemId: '', qty: '1' }]);
                setMatsMudou(true);
              }}
            >
              <Icone nome="mais" className="h-4 w-4" /> Material
            </Botao>
            {custoMaterial > 0 ? (
              <span className="text-sm text-nevoa">
                Custo de material {dinheiro(custoMaterial)}
                {precoCents ? ` · sobra ${dinheiro(precoCents - custoMaterial)}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <div>
        <span className="mb-2 block text-[0.82rem] font-semibold text-nevoa">Cor na agenda</span>
        <div className="flex flex-wrap gap-2">
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              aria-pressed={dados.color === c}
              onClick={() => setDados({ ...dados, color: c })}
              className={`h-9 w-9 rounded-full ring-offset-2 ${dados.color === c ? 'ring-2 ring-tinta' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <Interruptor
        ligado={dados.onlineBooking}
        aoMudar={(v) => setDados({ ...dados, onlineBooking: v })}
        rotulo="Agendável pelo site"
      />
      <Interruptor
        ligado={dados.telehealth}
        aoMudar={(v) => setDados({ ...dados, telehealth: v })}
        rotulo="Atendimento online (teleconsulta)"
        descricao="O paciente entra pela sala de vídeo do profissional, pelo link da consulta."
      />
      {s ? (
        <Interruptor
          ligado={dados.active}
          aoMudar={(v) => setDados({ ...dados, active: v })}
          rotulo="Ativo"
        />
      ) : null}
      <Botao
        variante="principal"
        tamanho="grande"
        className="w-full"
        disabled={!dados.name.trim() || (dados.preco.trim() !== '' && precoCents === null)}
        onClick={salvar}
      >
        Salvar
      </Botao>
    </div>
  );
}
