'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@tagtech/domain';
import { chamar, type Pix } from '@/lib/api';

/**
 * Sinal da consulta no Pix: QR, copia e cola e contagem. Confere sozinho a cada 4 s e
 * avisa quando o banco confirma.
 */
export function PixSinal({
  token,
  inicial,
  aoPagar,
}: {
  token: string;
  inicial?: Pix | null;
  aoPagar: () => void;
}) {
  const [pix, setPix] = useState<Pix | null>(inicial ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  const gerar = () =>
    chamar<Pix>(`/public/appointments/${token}/pix`)
      .then((p) => {
        setPix(p);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));

  useEffect(() => {
    if (!pix) void gerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pix || pix.status !== 'pending') return;
    const t = setInterval(async () => {
      const r = await chamar<{ status: Pix['status'] }>(`/public/pix/${pix.id}`).catch(() => null);
      if (r && r.status !== 'pending') {
        setPix({ ...pix, status: r.status });
        if (r.status === 'approved') aoPagar();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [pix, aoPagar]);

  if (erro) {
    return <p className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm text-alerta">{erro}</p>;
  }
  if (!pix) return <div className="h-72 animate-pulse rounded-2xl bg-porcelana" />;

  const resta = Math.max(0, new Date(pix.expiresAt).getTime() - agora);
  const mm = Math.floor(resta / 60000);
  const ss = String(Math.floor((resta % 60000) / 1000)).padStart(2, '0');

  return (
    <section className="rounded-2xl bg-porcelana p-5 ring-1 ring-linha">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl">Pague o sinal para garantir</h3>
        <span className="text-lg font-semibold tabular-nums">{formatBRL(pix.amountCents)}</span>
      </div>
      <p className="mt-1 text-sm text-nevoa">
        Pague em até 30 minutos. Sem o sinal, o horário volta a ficar livre para outra pessoa.
      </p>
      <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3 ring-1 ring-linha">
        {pix.qrBase64 ? (
          <img
            src={`data:image/png;base64,${pix.qrBase64}`}
            alt="QR do Pix"
            className="h-52 w-52 [image-rendering:pixelated]"
          />
        ) : (
          <div className="grid h-52 w-52 place-items-center text-center text-sm text-nevoa">
            Pix de teste
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-sm text-nevoa" aria-live="polite">
        {resta > 0 ? `Vale por ${mm}:${ss}` : 'Este QR venceu.'}
      </p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(pix.pixCode);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2500);
        }}
        className="mt-4 h-13 w-full rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte"
      >
        {copiado ? 'Código copiado ✓' : 'Copiar código Pix'}
      </button>
      {resta === 0 ? (
        <button
          type="button"
          onClick={() => void gerar()}
          className="mt-2 h-11 w-full rounded-xl font-semibold text-marca ring-1 ring-linha"
        >
          Gerar outro QR
        </button>
      ) : null}
      {pix.test ? (
        <button
          type="button"
          onClick={() =>
            void chamar(`/public/pix/${pix.id}/fake-approve`, { method: 'POST', body: '{}' })
          }
          className="mt-2 w-full text-center text-xs text-bruma underline"
        >
          Simular pagamento (ambiente de teste)
        </button>
      ) : null}
    </section>
  );
}
