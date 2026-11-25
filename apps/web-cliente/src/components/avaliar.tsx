'use client';

import { useState } from 'react';
import { chamar, type ReviewView } from '@/lib/api';
import { imagem } from '@/lib/tema';

const FRASES = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];

/** Nota de 1 a 5. Nota alta convida para o Google; nota baixa vai só para a clínica. */
export function Avaliar({ token, inicial }: { token: string; inicial: ReviewView }) {
  const [v, setV] = useState(inicial);
  const [nota, setNota] = useState<number>(inicial.rating ?? 0);
  const [passando, setPassando] = useState(0);
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const respondeu = v.rating !== null;

  async function enviar(n: number, texto = '') {
    setErro(null);
    setOcupado(true);
    try {
      setV(
        await chamar<ReviewView>(`/public/reviews/${token}`, {
          method: 'POST',
          body: JSON.stringify({ rating: n, comment: texto }),
        }),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally {
      setOcupado(false);
    }
  }

  const mostra = passando || nota;

  return (
    <main className="min-h-dvh">
      <div className="sobre-marca bg-marca px-5 pt-8 pb-24 text-sobre-marca">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {v.clinic.logoUrl ? (
            <img
              src={imagem(v.clinic.logoUrl)}
              alt=""
              className="h-10 w-10 rounded-xl object-cover"
            />
          ) : null}
          <span className="font-semibold">{v.clinic.name}</span>
        </div>
      </div>
      <div className="mx-auto -mt-16 max-w-lg px-5 pb-16">
        <div className="rounded-[1.75rem] bg-folha p-6 text-center shadow-[0_30px_60px_-40px_rgb(15_32_40/0.5)] ring-1 ring-linha sm:p-8">
          <p className="text-sm font-semibold text-nevoa">Olá, {v.patientFirstName}</p>
          <h1 className="mt-1 text-[1.9rem] leading-tight font-medium">
            {respondeu ? 'Obrigado por responder!' : 'Como foi o seu atendimento?'}
          </h1>

          {!respondeu ? (
            <>
              <div
                role="radiogroup"
                aria-label="Nota de 1 a 5"
                className="mt-7 flex justify-center gap-1.5"
                onMouseLeave={() => setPassando(0)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={nota === n}
                    aria-label={`${n} — ${FRASES[n]}`}
                    onMouseEnter={() => setPassando(n)}
                    onClick={() => {
                      setNota(n);
                      // Nota alta não precisa de mais nada: registra e mostra o Google.
                      if (n >= 4) void enviar(n);
                    }}
                    className="grid h-14 w-14 place-items-center rounded-2xl transition-transform active:scale-90"
                  >
                    <svg viewBox="0 0 24 24" className="h-11 w-11" aria-hidden>
                      <path
                        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"
                        fill={n <= mostra ? 'var(--color-destaque)' : 'transparent'}
                        stroke={n <= mostra ? 'var(--color-destaque)' : 'var(--color-linha)'}
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              <p className="mt-2 h-6 text-nevoa">{FRASES[mostra]}</p>

              {nota > 0 && nota <= 3 ? (
                <div className="mt-5 text-left">
                  <label className="block text-sm font-semibold text-nevoa" htmlFor="comentario">
                    O que podemos melhorar? Vai direto para a clínica.
                  </label>
                  <textarea
                    id="comentario"
                    rows={4}
                    maxLength={1000}
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    className="mt-2 w-full rounded-2xl bg-porcelana px-4 py-3 ring-1 ring-linha focus:ring-2 focus:ring-marca focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => enviar(nota, comentario.trim())}
                    className="mt-3 h-13 w-full rounded-2xl bg-marca text-[1.05rem] font-semibold text-sobre-marca disabled:opacity-50"
                  >
                    Enviar para a clínica
                  </button>
                </div>
              ) : null}
              {erro ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta"
                >
                  {erro}
                </p>
              ) : null}
            </>
          ) : v.googleUrl ? (
            <>
              <p className="mt-3 text-nevoa">
                Que bom! Conta isso no Google? Ajuda outras pessoas a encontrar a {v.clinic.name}.
              </p>
              <a
                href={v.googleUrl}
                className="mt-6 flex h-13 w-full items-center justify-center rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte"
              >
                Avaliar no Google
              </a>
            </>
          ) : (
            <p className="mt-3 text-nevoa">
              A {v.clinic.name} recebeu sua resposta e vai usar para melhorar.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
