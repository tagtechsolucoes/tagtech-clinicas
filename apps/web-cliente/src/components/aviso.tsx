import type { ReactNode } from 'react';

/** Tela simples de recado (link inválido, clínica não encontrada). */
export function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <img src="/icone.svg" alt="" className="mx-auto h-12 w-12 rounded-2xl" />
        <h1 className="mt-6 text-[1.9rem] leading-tight font-medium">{titulo}</h1>
        <p className="mt-3 text-nevoa">{children}</p>
      </div>
    </main>
  );
}
