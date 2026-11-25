'use client';

import { useEffect, useRef, useState } from 'react';
import { chamar, type ManageView } from '@/lib/api';
import { estiloDoTema, imagem, temaSeguro } from '@/lib/tema';

interface TvView {
  clinic: ManageView['clinic'];
  timezone: string;
  calls: Array<{ id: string; displayName: string; destination: string; at: string }>;
}

/** Dois toques curtos e suaves quando entra uma chamada nova. */
function tocar(ctx: AudioContext) {
  [0, 0.28].forEach((t, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = i ? 784 : 1046;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + 0.65);
  });
}

export function Tv({ token }: { token: string }) {
  const [v, setV] = useState<TvView | null>(null);
  const [erro, setErro] = useState<string | null>(token ? null : 'Link inválido.');
  const [agora, setAgora] = useState(() => new Date());
  const [som, setSom] = useState<AudioContext | null>(null);
  const ultima = useRef<string | null>(null);
  const [nova, setNova] = useState(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await chamar<TvView>(`/public/tv/${token}`);
        if (!vivo) return;
        setErro(null);
        setV(r);
        const topo = r.calls[0]?.id ?? null;
        if (topo && ultima.current && topo !== ultima.current) {
          setNova(true);
          setTimeout(() => setNova(false), 6000);
          if (som) tocar(som);
        }
        ultima.current = topo;
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : 'Sem conexão.');
      }
    };
    void buscar();
    const t = setInterval(buscar, 3000);
    const c = setInterval(() => setAgora(new Date()), 10_000);
    return () => {
      vivo = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, [token, som]);

  if (erro && !v)
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0f2028] p-10 text-center text-white">
        <div>
          <p className="font-display text-4xl">TV desconectada</p>
          <p className="mt-3 text-white/70">{erro}</p>
        </div>
      </main>
    );
  if (!v) return <main className="min-h-dvh bg-[#0f2028]" />;

  const { estilo } = estiloDoTema(temaSeguro(v.clinic.theme));
  const hora = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: v.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  const [atual, ...antes] = v.calls;

  return (
    <main style={estilo} className="sobre-marca flex min-h-dvh flex-col bg-marca text-sobre-marca">
      <header className="flex items-center justify-between px-[4vw] pt-[3vw]">
        <div className="flex items-center gap-4">
          {v.clinic.logoUrl ? (
            <img
              src={imagem(v.clinic.logoUrl)}
              alt=""
              className="h-[4vw] w-[4vw] rounded-2xl object-cover"
            />
          ) : null}
          <span className="text-[2vw] font-semibold">{v.clinic.name}</span>
        </div>
        <span className="font-display text-[3vw] tabular-nums">{hora(agora)}</span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-[4vw] text-center">
        {atual ? (
          <>
            <p className="text-[1.8vw] tracking-wide text-sobre-marca/70">Chamando</p>
            <p
              key={atual.id}
              className={`mt-[1vw] font-display text-[9vw] leading-none ${nova ? 'animate-[pulse_1s_ease-in-out_3]' : ''}`}
            >
              {atual.displayName}
            </p>
            <p className="mt-[2vw] rounded-full bg-destaque px-[2.5vw] py-[0.8vw] text-[3vw] font-semibold text-sobre-destaque">
              {atual.destination}
            </p>
          </>
        ) : (
          <p className="font-display text-[4vw] text-sobre-marca/80">Bem-vindo à {v.clinic.name}</p>
        )}
      </section>

      {antes.length ? (
        <footer className="grid grid-cols-5 gap-[1.5vw] border-t border-white/15 px-[4vw] py-[2vw]">
          {antes.slice(0, 5).map((c) => (
            <div key={c.id}>
              <p className="truncate text-[1.6vw] font-semibold">{c.displayName}</p>
              <p className="truncate text-[1.2vw] text-sobre-marca/65">
                {c.destination} · {hora(new Date(c.at))}
              </p>
            </div>
          ))}
        </footer>
      ) : null}

      {!som ? (
        <button
          type="button"
          onClick={() => setSom(new AudioContext())}
          className="fixed right-[2vw] bottom-[2vw] rounded-2xl bg-white/10 px-5 py-3 text-[1.2vw] font-semibold"
        >
          Ativar som da chamada
        </button>
      ) : null}
    </main>
  );
}
