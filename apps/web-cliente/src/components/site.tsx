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
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
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
