import { useCallback, useRef, useState } from 'react';
import type { Me } from './api';
import { AvisoContexto } from './contexto';
import { InstalarApp } from './instalar';
import { TagTechTela } from './tagtech';
import { Recado } from './ui';

/**
 * Administração da TagTech: quem está em PLATFORM_ADMINS entra aqui, fora de qualquer
 * clínica. Se também for da equipe de alguma clínica, abre o painel dela por aqui.
 */
export function Plataforma({
  me,
  aoAbrirClinica,
  aoSair,
}: {
  me: Me;
  aoAbrirClinica: (tenantId: string) => void;
  aoSair: () => void;
}) {
  const [recado, setRecado] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback((texto: string, tipo: 'ok' | 'erro' = 'ok') => {
    setRecado({ texto, tipo });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRecado(null), tipo === 'erro' ? 6000 : 3000);
  }, []);

  return (
    <AvisoContexto.Provider value={avisar}>
      <div className="min-h-full bg-porcelana">
        <header className="bg-petroleo-escuro text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-4 lg:px-10">
            <img src="/icone.svg" alt="" className="h-9 w-9" />
            <div className="mr-auto min-w-0">
              <p className="font-display text-lg leading-tight font-semibold">
                Administração TagTech
              </p>
              <p className="truncate text-sm text-white/60">{me.email}</p>
            </div>
            {me.memberships.length > 0 ? (
              <details className="group relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/75 ring-1 ring-white/15 hover:text-white [&::-webkit-details-marker]:hidden">
                  Abrir uma clínica
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <ul className="absolute right-0 z-30 mt-2 w-64 rounded-2xl bg-folha p-1.5 text-tinta shadow-xl ring-1 ring-linha">
                  {me.memberships.map((m) => (
                    <li key={m.tenantId}>
                      <button
                        type="button"
                        onClick={() => aoAbrirClinica(m.tenantId)}
                        className="w-full truncate rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-agua/60"
                      >
                        {m.tenantName}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <InstalarApp
              className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/75 ring-1 ring-white/15 hover:text-white"
              dicaClassName="absolute right-5 mt-2 max-w-xs rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white/80"
            />
            <button
              type="button"
              onClick={aoSair}
              className="h-10 rounded-xl px-4 text-sm font-semibold text-white/75 ring-1 ring-white/15 hover:text-white"
            >
              Sair
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-10 lg:py-12">
          <TagTechTela />
        </main>
        <Recado texto={recado?.texto ?? null} tipo={recado?.tipo ?? 'ok'} />
      </div>
    </AvisoContexto.Provider>
  );
}
