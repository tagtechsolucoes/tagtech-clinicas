import type { ReactNode } from 'react';

/** Peças visuais do site da clínica (sem estado; rodam no servidor). */

const TRACOS: Record<string, ReactNode> = {
  calendario: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  seta: <path d="M5 12h14M13 6l6 6-6 6" />,
  pino: (
    <>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  relogio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  escudo: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" />
      <path d="M8.8 12l2.3 2.3 4.3-4.6" />
    </>
  ),
  documento: (
    <>
      <path d="M7 3.5h7l4.5 4.5v12.5H7z" />
      <path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h6" />
    </>
  ),
  coracao: (
    <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
  ),
  mais: <path d="M12 5v14M5 12h14" />,
  zap: (
    <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5zm-3 5c.3-.6.6-.6.9-.6h.6c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.5.7c-.1.2-.2.3 0 .6a6.6 6.6 0 0 0 3.1 2.7c.3.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.2.4.4 0 .3 0 1.2-.7 1.8-.6.6-1.6.8-2.6.5a10.7 10.7 0 0 1-5.6-4.9c-.8-1.4-.7-2.6-.2-3.4z" />
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </>
  ),
  estrela: (
    <path d="M12 3.8l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8L8 13.6 3.8 9.7l5.7-.7z" />
  ),
};

export type NomeIcone = keyof typeof TRACOS;

export function Icone({ nome, className = 'h-5 w-5' }: { nome: NomeIcone; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={nome === 'estrela' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={nome === 'zap' ? 0 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {nome === 'zap' ? <g fill="currentColor">{TRACOS.zap}</g> : TRACOS[nome]}
    </svg>
  );
}

/** Botão em pílula. Cheio leva o ícone num círculo branco. */
export function Pilula({
  href,
  children,
  icone = 'calendario',
  vazia,
  externo,
  className = '',
}: {
  href: string;
  children: ReactNode;
  icone?: NomeIcone;
  vazia?: boolean;
  externo?: boolean;
  className?: string;
}) {
  return (
    <a
      href={href}
      {...(externo ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={`pilula ${vazia ? 'pilula-vazia' : 'pilula-cheia'} ${className}`}
    >
      {children}
      {vazia ? null : (
        <span className="pilula-icone">
          <Icone nome={icone} className="h-[1.1rem] w-[1.1rem]" />
        </span>
      )}
    </a>
  );
}

/** Rótulo de seção em pílula, acima do título. */
export function Rotulo({ children, claro }: { children: ReactNode; claro?: boolean | undefined }) {
  return (
    <span
      className={`inline-flex rounded-full px-3.5 py-1 text-[0.8rem] font-semibold ${
        claro
          ? 'bg-white/10 text-sobre-marca ring-1 ring-white/20'
          : 'bg-white text-marca ring-1 ring-[var(--marca-borda)]'
      }`}
    >
      {children}
    </span>
  );
}

export function Titulo({
  rotulo,
  children,
  texto,
  centro,
  claro,
}: {
  rotulo?: string;
  children: ReactNode;
  texto?: ReactNode;
  centro?: boolean;
  claro?: boolean;
}) {
  return (
    <div className={centro ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
      {rotulo ? <Rotulo claro={claro}>{rotulo}</Rotulo> : null}
      <h2
        className={`mt-4 text-[2.1rem] leading-[1.08] text-balance sm:text-[2.7rem] ${
          claro ? 'text-sobre-marca' : 'text-marca-fundo'
        }`}
      >
        {children}
      </h2>
      {texto ? (
        <p
          className={`mt-4 text-[1.05rem] leading-relaxed ${claro ? 'text-sobre-marca/75' : 'text-nevoa'}`}
        >
          {texto}
        </p>
      ) : null}
    </div>
  );
}

/** Selo redondo com o nome da clínica girando em volta do ícone. */
export function Selo({ texto, className = '' }: { texto: string; className?: string }) {
  const t = `${texto} · ${texto} · `.toUpperCase();
  return (
    <div
      className={`grid h-28 w-28 place-items-center rounded-full bg-white/95 shadow-[0_16px_32px_-18px_rgb(15_32_40/0.55)] ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 120 120" className="gira absolute h-28 w-28 text-marca">
        <defs>
          <path id="selo-circulo" d="M60 60m-45 0a45 45 0 1 1 90 0a45 45 0 1 1-90 0" />
        </defs>
        <text fill="currentColor" fontSize="9.5" letterSpacing="2.6" fontWeight="600">
          <textPath href="#selo-circulo" textLength="280">
            {t}
          </textPath>
        </text>
      </svg>
      <span className="grid h-12 w-12 place-items-center rounded-full text-sobre-marca [background:var(--marca-grad)]">
        <Icone nome="estrela" className="h-5 w-5" />
      </span>
    </div>
  );
}

export function Estrelas({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span className="flex gap-0.5 text-destaque" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <Icone key={i} nome="estrela" className={className} />
      ))}
    </span>
  );
}
