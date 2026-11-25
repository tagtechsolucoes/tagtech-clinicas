import { useEffect, useState } from 'react';
import { api, type SessionPackage } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dinheiro, hoje } from '../formato';
import {
  Botao,
  Campo,
  Entrada,
  EntradaDinheiro,
  Gaveta,
  Icone,
  Interruptor,
  Seletor,
  Vazio,
} from '../ui';

/** Aba "Pacotes" do paciente: sessões compradas, usadas e marcadas. */
export function Pacotes({ patientId }: { patientId: string }) {
  const { avisar, vinculo, services } = usePainel();
  const [lista, setLista] = useState<SessionPackage[] | null>(null);
  const [novo, setNovo] = useState(false);
  const podeVender = vinculo.role !== 'professional';

  const carregar = () =>
    api
      .packages(patientId)
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (!lista) return <p className="text-nevoa">Carregando…</p>;

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-nevoa">
          Ao agendar, escolha o pacote: a sessão sai sem cobrança e a contagem anda sozinha.
        </p>
        {podeVender ? (
          <Botao variante="principal" onClick={() => setNovo(true)}>
            <Icone nome="mais" className="h-4 w-4" /> Novo pacote
          </Botao>
        ) : null}
      </div>

      {lista.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {lista.map((p) => {
            const feitas = (p.used / p.totalSessions) * 100;
            const marcadas = (p.booked / p.totalSessions) * 100;
            return (
              <li
                key={p.id}
                className={`rounded-3xl bg-folha p-5 ring-1 ${p.endingSoon ? 'ring-ambar' : 'ring-linha'} ${p.status !== 'active' ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.title}</p>
                    <p className="text-sm text-nevoa">
                      {p.priceCents ? `${dinheiro(p.priceCents)} · ` : ''}
                      desde {dataCurta(p.createdAt.slice(0, 10))}
                      {p.validUntil ? ` · vale até ${dataCurta(p.validUntil)}` : ''}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      p.status === 'active'
                        ? p.endingSoon
                          ? 'bg-ambar-fundo text-ambar-tinta'
                          : 'bg-ok-fundo text-ok'
                        : 'bg-trilho text-nevoa'
                    }`}
                  >
                    {p.status === 'active'
                      ? p.endingSoon
                        ? 'Acabando'
                        : 'Ativo'
                      : p.status === 'finished'
                        ? 'Concluído'
                        : 'Cancelado'}
                  </span>
                </div>
                <p className="mt-5 font-display text-4xl tabular-nums">
                  {p.used}
                  <span className="text-xl text-nevoa"> de {p.totalSessions}</span>
                </p>
                <div
                  className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-trilho"
                  role="img"
                  aria-label={`${p.used} feitas, ${p.booked} marcadas, ${p.free} para marcar`}
                >
                  <span className="bg-petroleo" style={{ width: `${feitas}%` }} />
                  <span className="bg-petroleo/35" style={{ width: `${marcadas}%` }} />
                </div>
                <p className="mt-2 text-sm text-nevoa">
                  {p.booked} marcadas · {Math.max(0, p.free)} para marcar
                  {p.noShowCounts ? ' · falta conta como sessão' : ''}
                </p>
                {p.status === 'active' &&
                (vinculo.role === 'owner' || vinculo.role === 'manager') ? (
                  <Botao
                    tamanho="pequeno"
                    variante="discreto"
                    className="mt-3 -ml-3"
                    onClick={() =>
                      api
                        .cancelPackage(p.id)
                        .then(carregar)
                        .catch((e) => avisar(mensagem(e), 'erro'))
                    }
                  >
                    Cancelar pacote
                  </Botao>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Vazio
          titulo="Nenhum pacote"
          texto="Venda 5, 10 ou 20 sessões de uma vez. A agenda conta o que foi usado e avisa quando estiver acabando."
        />
      )}

      <NovoPacote
        aberto={novo}
        patientId={patientId}
        servicos={services.filter((s) => s.active)}
        aoFechar={() => setNovo(false)}
        aoCriar={() => {
          setNovo(false);
          avisar('Pacote criado');
          void carregar();
        }}
      />
    </>
  );
}

function NovoPacote({
  aberto,
  patientId,
  servicos,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  patientId: string;
  servicos: Array<{ id: string; name: string; priceCents: number | null }>;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const { avisar } = usePainel();
  const [serviceId, setServiceId] = useState(servicos[0]?.id ?? '');
  const [sessoes, setSessoes] = useState(10);
  const [preco, setPreco] = useState<number | null>(null);
  const [parcelas, setParcelas] = useState(1);
  const [falta, setFalta] = useState(true);
  const [validade, setValidade] = useState('');
  const s = servicos.find((x) => x.id === serviceId);
  const cheio = (s?.priceCents ?? 0) * sessoes;

  async function criar() {
    try {
      await api.createPackage(patientId, {
        serviceId,
        totalSessions: sessoes,
        priceCents: preco ?? 0,
        noShowCounts: falta,
        validUntil: validade || null,
        ...(preco ? { charge: { installments: parcelas } } : {}),
      });
      aoCriar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <Gaveta
      aberta={aberto}
      aoFechar={aoFechar}
      titulo="Novo pacote"
      rodape={
        <Botao variante="principal" className="flex-1" disabled={!serviceId} onClick={criar}>
          Criar pacote
        </Botao>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Serviço">
          <Seletor value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {servicos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Seletor>
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="Sessões">
            <Seletor value={sessoes} onChange={(e) => setSessoes(Number(e.target.value))}>
              {[4, 5, 6, 8, 10, 12, 15, 20, 24, 30].map((n) => (
                <option key={n} value={n}>
                  {n} sessões
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Vale até (opcional)">
            <Entrada
              type="date"
              min={hoje()}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
          </Campo>
          <Campo
            rotulo="Valor do pacote"
            ajuda={cheio ? `Avulso sairia ${dinheiro(cheio)}.` : 'Vazio: não lança no financeiro.'}
          >
            <EntradaDinheiro valor={preco} aoMudar={setPreco} />
          </Campo>
          <Campo rotulo="Pagamento">
            <Seletor
              value={parcelas}
              onChange={(e) => setParcelas(Number(e.target.value))}
              disabled={!preco}
            >
              {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'À vista' : `${n}x`}
                </option>
              ))}
            </Seletor>
          </Campo>
        </div>
        <Interruptor
          ligado={falta}
          aoMudar={setFalta}
          rotulo="Falta conta como sessão usada"
          descricao="Comum em fisioterapia e psicologia. Desligado, a falta devolve a sessão ao pacote."
        />
      </div>
    </Gaveta>
  );
}
