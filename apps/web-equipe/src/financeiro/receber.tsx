import { useEffect, useState } from 'react';
import { PAY_METHOD_LABELS, PAY_METHODS, type PayMethod } from '@tagtech/domain';
import { api, type Charge, type Pix } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dinheiro } from '../formato';
import { Botao, Gaveta, Icone } from '../ui';

/**
 * Receber uma cobrança: no balcão (escolhe a forma) ou no Pix, com QR que se baixa
 * sozinho quando o Mercado Pago confirma.
 */
export function Receber({
  cobranca,
  aoFechar,
  aoReceber,
}: {
  cobranca: Charge | null;
  aoFechar: () => void;
  aoReceber: () => void;
}) {
  const { avisar, tem } = usePainel();
  const [metodo, setMetodo] = useState<PayMethod>('cash');
  const [pix, setPix] = useState<Pix | null>(null);
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setPix(null);
    setMetodo('cash');
  }, [cobranca?.id]);

  // Confere o Pix a cada 4 s enquanto a gaveta está aberta.
  useEffect(() => {
    if (!pix || pix.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const { status } = await api.pixStatus(pix.id);
        if (status !== 'pending') {
          setPix({ ...pix, status });
          if (status === 'approved') {
            avisar('Pix recebido');
            aoReceber();
          }
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [pix, avisar, aoReceber]);

  async function gerarPix() {
    if (!cobranca) return;
    setGerando(true);
    try {
      setPix(await api.chargePix(cobranca.id));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setGerando(false);
    }
  }

  async function baixar() {
    if (!cobranca) return;
    setSalvando(true);
    try {
      await api.payCharge(cobranca.id, metodo);
      avisar(`Recebido em ${PAY_METHOD_LABELS[metodo].toLowerCase()}`);
      aoReceber();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      aberta={cobranca !== null}
      aoFechar={aoFechar}
      titulo={cobranca ? dinheiro(cobranca.amountCents) : ''}
      subtitulo={
        cobranca
          ? [cobranca.description, cobranca.patientName, `vence ${dataCurta(cobranca.dueDate)}`]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      rodape={
        pix ? null : (
          <Botao variante="principal" className="flex-1" disabled={salvando} onClick={baixar}>
            <Icone nome="ok" className="h-4 w-4" />
            Recebi em {PAY_METHOD_LABELS[metodo].toLowerCase()}
          </Botao>
        )
      }
    >
      {pix ? (
        <QrPix pix={pix} aoVoltar={() => setPix(null)} />
      ) : (
        <div className="space-y-7">
          {tem('pix') ? (
            <section className="rounded-3xl bg-petroleo p-5 text-white">
              <p className="font-display text-xl">Cobrar no Pix agora</p>
              <p className="mt-1 text-sm text-white/75">
                Mostre o QR ao paciente ou mande o código. A baixa é automática quando o banco
                confirma.
              </p>
              <Botao variante="destaque" className="mt-4" disabled={gerando} onClick={gerarPix}>
                <Icone nome="qr" className="h-4 w-4" />
                {gerando ? 'Gerando…' : 'Gerar QR do Pix'}
              </Botao>
            </section>
          ) : null}

          <fieldset>
            <legend className="mb-3 text-[0.82rem] font-semibold text-nevoa">
              Ou dê baixa do que já entrou
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PAY_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={metodo === m}
                  onClick={() => setMetodo(m)}
                  className={`h-12 rounded-xl text-[0.95rem] font-semibold ring-1 transition ${
                    metodo === m
                      ? 'bg-agua text-petroleo ring-2 ring-petroleo'
                      : 'bg-folha ring-linha hover:ring-tinta/30'
                  }`}
                >
                  {PAY_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </Gaveta>
  );
}

export function QrPix({ pix, aoVoltar }: { pix: Pix; aoVoltar?: () => void }) {
  const { avisar } = usePainel();
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const resta = Math.max(0, new Date(pix.expiresAt).getTime() - agora);
  const mm = Math.floor(resta / 60000);
  const ss = String(Math.floor((resta % 60000) / 1000)).padStart(2, '0');

  if (pix.status === 'approved') {
    return (
      <div className="grid place-items-center py-10 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-ok-fundo text-ok">
          <Icone nome="ok" className="h-10 w-10" />
        </span>
        <p className="mt-5 font-display text-2xl">Pix recebido</p>
        <p className="mt-1 text-nevoa">{dinheiro(pix.amountCents)} já está no caixa de hoje.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="mx-auto w-fit rounded-3xl bg-white p-4 ring-1 ring-linha">
        {pix.qrBase64 ? (
          <img
            src={`data:image/png;base64,${pix.qrBase64}`}
            alt="QR do Pix"
            className="h-56 w-56 [image-rendering:pixelated]"
          />
        ) : (
          <div className="grid h-56 w-56 place-items-center rounded-2xl bg-trilho text-center text-sm text-nevoa">
            Pix de teste
            <br />
            (sem QR)
          </div>
        )}
      </div>
      <p className="text-center text-sm text-nevoa" aria-live="polite">
        {pix.status === 'pending'
          ? resta > 0
            ? `Aguardando pagamento · vale por ${mm}:${ss}`
            : 'Este QR venceu. Gere outro.'
          : 'Este Pix não vale mais.'}
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={pix.pixCode}
          aria-label="Pix copia e cola"
          onFocus={(e) => e.target.select()}
          className="h-11 min-w-0 flex-1 truncate rounded-xl bg-trilho px-3 font-mono text-xs text-nevoa"
        />
        <Botao
          onClick={() => {
            void navigator.clipboard.writeText(pix.pixCode);
            avisar('Código copiado');
          }}
        >
          <Icone nome="copiar" className="h-4 w-4" /> Copiar
        </Botao>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {pix.test && pix.status === 'pending' ? (
          <Botao
            variante="discreto"
            tamanho="pequeno"
            onClick={() => api.fakeApprovePix(pix.id).catch((e) => avisar(mensagem(e), 'erro'))}
          >
            Simular pagamento (teste)
          </Botao>
        ) : null}
        {aoVoltar ? (
          <Botao variante="discreto" tamanho="pequeno" onClick={aoVoltar}>
            Receber de outro jeito
          </Botao>
        ) : null}
      </div>
    </div>
  );
}
