import { useEffect, useState } from 'react';
import { api, type Insurer, type PatientInsurance } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, hoje } from '../formato';
import { Botao, Campo, Entrada, Icone, Seletor, Vazio } from '../ui';

/** Aba "Convênio" do paciente: carteirinhas e guias autorizadas. */
export function Convenio({ patientId }: { patientId: string }) {
  const { avisar, services, vinculo } = usePainel();
  const pode = vinculo.role !== 'professional';
  const [dados, setDados] = useState<PatientInsurance | null>(null);
  const [planos, setPlanos] = useState<Insurer[]>([]);
  const [cartao, setCartao] = useState({
    insurerId: '',
    cardNumber: '',
    planName: '',
    validUntil: '',
  });
  const [guia, setGuia] = useState({
    insurerId: '',
    serviceId: '',
    guideNumber: '',
    password: '',
    validUntil: '',
    sessions: '1',
  });
  const [modo, setModo] = useState<'cartao' | 'guia' | null>(null);

  useEffect(() => {
    Promise.all([api.patientInsurance(patientId), api.insurers()])
      .then(([d, p]) => {
        setDados(d);
        setPlanos(p.filter((x) => x.active));
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [patientId, avisar]);

  async function agir(fn: () => Promise<PatientInsurance>, ok: string) {
    try {
      setDados(await fn());
      setModo(null);
      avisar(ok);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  if (!dados) return <p className="text-nevoa">Carregando…</p>;
  const cobre = (insurerId: string) =>
    planos.find((p) => p.id === insurerId)?.prices.map((p) => p.serviceId) ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-xl">Carteirinhas</h3>
          {pode ? (
            <Botao tamanho="pequeno" onClick={() => setModo(modo === 'cartao' ? null : 'cartao')}>
              <Icone nome="mais" className="h-4 w-4" /> Carteirinha
            </Botao>
          ) : null}
        </div>
        {modo === 'cartao' ? (
          <div className="mb-4 space-y-3 rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
            <Seletor
              aria-label="Convênio"
              value={cartao.insurerId}
              onChange={(e) => setCartao({ ...cartao, insurerId: e.target.value })}
            >
              <option value="">Escolha o convênio</option>
              {planos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Seletor>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Número da carteirinha">
                <Entrada
                  value={cartao.cardNumber}
                  maxLength={30}
                  onChange={(e) => setCartao({ ...cartao, cardNumber: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Plano">
                <Entrada
                  value={cartao.planName}
                  maxLength={60}
                  placeholder="Ex.: Ouro"
                  onChange={(e) => setCartao({ ...cartao, planName: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Validade">
                <Entrada
                  type="date"
                  value={cartao.validUntil}
                  onChange={(e) => setCartao({ ...cartao, validUntil: e.target.value })}
                />
              </Campo>
            </div>
            <Botao
              variante="principal"
              disabled={!cartao.insurerId || !cartao.cardNumber.trim()}
              onClick={() =>
                agir(
                  () =>
                    api.setCard(patientId, cartao.insurerId, {
                      cardNumber: cartao.cardNumber.trim(),
                      planName: cartao.planName.trim(),
                      validUntil: cartao.validUntil || null,
                    }),
                  'Carteirinha salva',
                )
              }
            >
              Salvar carteirinha
            </Botao>
          </div>
        ) : null}
        {dados.cards.length ? (
          <ul className="space-y-3">
            {dados.cards.map((c) => {
              const vencida = c.validUntil !== null && c.validUntil < hoje();
              return (
                <li
                  key={c.insurerId}
                  className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-petroleo to-[#2b6a7d] p-5 text-white"
                >
                  <p className="text-sm text-white/70">
                    {c.insurerName}
                    {c.planName ? ` · ${c.planName}` : ''}
                  </p>
                  <p className="mt-2 font-mono text-xl tracking-wider">{c.cardNumber}</p>
                  <p
                    className={`mt-2 text-sm ${vencida ? 'font-semibold text-[#ffb4a8]' : 'text-white/70'}`}
                  >
                    {c.validUntil
                      ? `${vencida ? 'Venceu' : 'Válida até'} ${dataCurta(c.validUntil)}`
                      : 'Sem validade informada'}
                  </p>
                  {pode ? (
                    <button
                      type="button"
                      aria-label="Tirar carteirinha"
                      onClick={() =>
                        agir(() => api.removeCard(patientId, c.insurerId), 'Carteirinha removida')
                      }
                      className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <Icone nome="x" className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Vazio
            titulo="Atende particular"
            texto="Cadastre a carteirinha para marcar consultas pelo convênio."
          />
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-xl">Guias autorizadas</h3>
          {pode && dados.cards.length ? (
            <Botao tamanho="pequeno" onClick={() => setModo(modo === 'guia' ? null : 'guia')}>
              <Icone nome="mais" className="h-4 w-4" /> Guia
            </Botao>
          ) : null}
        </div>
        {modo === 'guia' ? (
          <div className="mb-4 space-y-3 rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
            <div className="grid grid-cols-2 gap-3">
              <Seletor
                aria-label="Convênio"
                value={guia.insurerId}
                onChange={(e) => setGuia({ ...guia, insurerId: e.target.value, serviceId: '' })}
              >
                <option value="">Convênio</option>
                {dados.cards.map((c) => (
                  <option key={c.insurerId} value={c.insurerId}>
                    {c.insurerName}
                  </option>
                ))}
              </Seletor>
              <Seletor
                aria-label="Procedimento"
                value={guia.serviceId}
                onChange={(e) => setGuia({ ...guia, serviceId: e.target.value })}
              >
                <option value="">Procedimento</option>
                {services
                  .filter((s) => cobre(guia.insurerId).includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Seletor>
              <Campo rotulo="Número da guia">
                <Entrada
                  value={guia.guideNumber}
                  maxLength={20}
                  onChange={(e) => setGuia({ ...guia, guideNumber: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Senha">
                <Entrada
                  value={guia.password}
                  maxLength={20}
                  onChange={(e) => setGuia({ ...guia, password: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Sessões liberadas">
                <Entrada
                  inputMode="numeric"
                  value={guia.sessions}
                  onChange={(e) => setGuia({ ...guia, sessions: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Validade">
                <Entrada
                  type="date"
                  value={guia.validUntil}
                  onChange={(e) => setGuia({ ...guia, validUntil: e.target.value })}
                />
              </Campo>
            </div>
            <Botao
              variante="principal"
              disabled={!guia.insurerId || !guia.serviceId || !guia.guideNumber.trim()}
              onClick={() =>
                agir(
                  () =>
                    api.addAuthorization(patientId, {
                      insurerId: guia.insurerId,
                      serviceId: guia.serviceId,
                      guideNumber: guia.guideNumber.trim(),
                      password: guia.password.trim(),
                      validUntil: guia.validUntil || null,
                      sessions: Math.max(1, Number(guia.sessions) || 1),
                    }),
                  'Guia registrada',
                )
              }
            >
              Registrar guia
            </Botao>
          </div>
        ) : null}
        {dados.authorizations.length ? (
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {dados.authorizations.map((g) => {
              const vencida = g.validUntil !== null && g.validUntil < hoje();
              const resta = g.sessions - g.used;
              return (
                <li key={g.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        Guia {g.guideNumber}
                        {g.password ? (
                          <span className="font-normal text-nevoa"> · senha {g.password}</span>
                        ) : null}
                      </span>
                      <span className="text-sm text-nevoa">
                        {g.insurerName} · {g.serviceName}
                        {g.validUntil
                          ? ` · ${vencida ? 'venceu' : 'vale até'} ${dataCurta(g.validUntil)}`
                          : ''}
                      </span>
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${resta <= 0 || vencida ? 'bg-alerta-fundo text-alerta' : resta === 1 ? 'bg-ambar-fundo text-ambar-tinta' : 'bg-ok-fundo text-ok'}`}
                    >
                      {g.used}/{g.sessions} sessões
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-trilho">
                    <div
                      className="h-full rounded-full bg-petroleo"
                      style={{ width: `${Math.min(100, (g.used / g.sessions) * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-nevoa">
            Nenhuma guia. Procedimentos que pedem guia avisam na agenda.
          </p>
        )}
      </section>
    </div>
  );
}
