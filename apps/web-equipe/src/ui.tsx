import { parseBRL } from '@tagtech/domain';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

type Variante = 'principal' | 'destaque' | 'contorno' | 'discreto' | 'perigo';

const VARIANTES: Record<Variante, string> = {
  principal:
    'bg-petroleo text-white hover:bg-petroleo-escuro shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]',
  destaque: 'bg-ambar text-tinta hover:brightness-95',
  contorno: 'bg-folha text-tinta ring-1 ring-linha hover:ring-tinta/35',
  discreto: 'text-tinta hover:bg-tinta/[0.05]',
  perigo: 'bg-folha text-alerta ring-1 ring-linha hover:ring-alerta/40',
};

export function Botao({
  variante = 'contorno',
  tamanho = 'normal',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  tamanho?: 'pequeno' | 'normal' | 'grande';
}) {
  const t =
    tamanho === 'grande'
      ? 'h-12 px-6 text-base'
      : tamanho === 'pequeno'
        ? 'h-9 px-3 text-sm'
        : 'h-11 px-4 text-[0.95rem]';
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-[background-color,box-shadow,transform,filter] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${t} ${VARIANTES[variante]} ${className}`}
    />
  );
}

export const campo =
  'h-11 w-full rounded-xl bg-folha px-3.5 text-[0.95rem] text-tinta ring-1 ring-linha placeholder:text-bruma focus:ring-2 focus:ring-petroleo focus:outline-none transition-shadow';

export function Entrada(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${campo} ${props.className ?? ''}`} />;
}

export function Texto(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`w-full rounded-xl bg-folha px-3.5 py-2.5 text-[0.95rem] text-tinta ring-1 ring-linha placeholder:text-bruma focus:ring-2 focus:ring-petroleo focus:outline-none ${props.className ?? ''}`}
    />
  );
}

/** Lista de escolha com seta própria, sempre centralizada. */
export function Seletor({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select
        {...props}
        className={`block h-11 w-full appearance-none rounded-xl bg-folha pr-10 pl-3.5 text-[0.95rem] font-medium text-tinta ring-1 ring-linha focus:ring-2 focus:ring-petroleo focus:outline-none ${className}`}
      >
        {children}
      </select>
      <Icone
        nome="baixo"
        className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-nevoa"
      />
    </span>
  );
}

export function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string;
  ajuda?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.82rem] font-semibold text-nevoa">{rotulo}</span>
      {children}
      {ajuda ? <span className="mt-1.5 block text-[0.8rem] text-bruma">{ajuda}</span> : null}
    </label>
  );
}

export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  descricao,
}: {
  ligado: boolean;
  aoMudar: (v: boolean) => void;
  rotulo: string;
  descricao?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block font-semibold">{rotulo}</span>
        {descricao ? <span className="mt-0.5 block text-sm text-nevoa">{descricao}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        onClick={() => aoMudar(!ligado)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${ligado ? 'bg-petroleo' : 'bg-linha'}`}
      >
        <span
          className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  );
}

/** Gaveta lateral, usando o <dialog> nativo (foco preso e Esc para fechar de graça). */
export function Gaveta({
  aberta,
  aoFechar,
  titulo,
  subtitulo,
  children,
  rodape,
}: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);
  return (
    <dialog
      ref={ref}
      className="gaveta"
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === ref.current) aoFechar();
      }}
    >
      {aberta ? (
        <>
          <header className="flex items-start justify-between gap-4 border-b border-linha px-6 pt-6 pb-5">
            <div className="min-w-0">
              <h2 className="text-[1.6rem] leading-tight font-medium">{titulo}</h2>
              {subtitulo ? <p className="mt-1 text-sm text-nevoa">{subtitulo}</p> : null}
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mt-1 -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-nevoa hover:bg-tinta/5 hover:text-tinta"
            >
              <Icone nome="x" className="h-5 w-5" />
            </button>
          </header>
          <div className="rolagem-fina flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {rodape ? (
            <footer className="flex gap-3 border-t border-linha px-6 py-4">{rodape}</footer>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}

export function Recado({ texto, tipo }: { texto: string | null; tipo: 'ok' | 'erro' }) {
  if (!texto) return null;
  return (
    <div
      role="status"
      className={`recado fixed bottom-6 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-2xl px-5 py-3.5 text-[0.95rem] font-semibold shadow-[0_18px_40px_-16px_rgb(15_32_40/0.55)] ${
        tipo === 'erro' ? 'bg-alerta text-white' : 'bg-tinta text-white'
      }`}
    >
      <Icone nome={tipo === 'erro' ? 'alerta' : 'ok'} className="h-5 w-5 shrink-0" />
      {texto}
    </div>
  );
}

export function Cabecalho({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[2.2rem] leading-none font-medium">{titulo}</h1>
        {descricao ? <p className="mt-2.5 max-w-2xl text-nevoa">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap gap-2.5">{acoes}</div> : null}
    </div>
  );
}

export function Vazio({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: string;
  acao?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-linha bg-folha/60 px-8 py-14 text-center">
      <p className="font-display text-xl">{titulo}</p>
      <p className="mx-auto mt-2 max-w-md text-nevoa">{texto}</p>
      {acao ? <div className="mt-6">{acao}</div> : null}
    </div>
  );
}

export function Avatar({
  nome,
  cor,
  foto,
  tamanho = 'h-9 w-9 text-sm',
}: {
  nome: string;
  cor?: string;
  foto?: string | null;
  tamanho?: string;
}) {
  const iniciais = nome
    .replace(/^(dra?\.?|dr\.)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  if (foto)
    return (
      <img src={`/api${foto}`} alt="" className={`${tamanho} shrink-0 rounded-full object-cover`} />
    );
  return (
    <span
      aria-hidden="true"
      className={`${tamanho} grid shrink-0 place-items-center rounded-full font-semibold text-white`}
      style={{ background: cor ?? '#1d4e5f' }}
    >
      {iniciais}
    </span>
  );
}

const PATHS: Record<string, string> = {
  agenda:
    'M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 10h16M8.5 3v4M15.5 3v4',
  pessoas:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.3c1.8.8 3 2.6 3 4.7',
  espera: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  estetoscopio:
    'M6 3v6a5 5 0 0 0 10 0V3M11 14v2a4 4 0 0 0 8 0v-2M19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  lista: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  clinica: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M12 8v4M10 10h4',
  equipe:
    'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 7 18.5V20M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  mais: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  esquerda: 'M15 18l-6-6 6-6',
  direita: 'M9 6l6 6-6 6',
  baixo: 'M6 9l6 6 6-6',
  ok: 'M5 12.5l4.5 4.5L19 7.5',
  alerta:
    'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  whatsapp: 'M20 11.6a8.4 8.4 0 0 1-12.3 7.4L3 20.4l1.4-4.6A8.4 8.4 0 1 1 20 11.6z',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  sair: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  globo:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bloqueio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  editar: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  dinheiro: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 10v4M17.5 10v4',
  recibo: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  copiar: 'M9 9h10v11H9zM5 15V4h10',
  enviar: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
};

export function Icone({
  nome,
  className = 'h-5 w-5',
}: {
  nome: keyof typeof PATHS | string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[nome] ?? ''} />
    </svg>
  );
}

/** Chip de estado da consulta. Cor e texto dizem a mesma coisa (não só a cor). */
export const STATUS_ESTILO: Record<string, string> = {
  scheduled: 'bg-azul-fundo text-azul',
  confirmed: 'bg-ok-fundo text-ok',
  arrived: 'bg-ambar-fundo text-ambar-tinta',
  in_progress: 'bg-agua text-petroleo',
  done: 'bg-trilho text-nevoa',
  no_show: 'bg-alerta-fundo text-alerta',
  cancelled: 'bg-trilho text-bruma line-through',
};

/** Campo de valor em reais. Guarda centavos; aceita "1.234,56", "1234,5" ou "80". */
export function EntradaDinheiro({
  valor,
  aoMudar,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: number | null;
  aoMudar: (cents: number | null) => void;
}) {
  const [texto, setTexto] = useState(valor === null ? '' : centsParaTexto(valor));
  useEffect(() => {
    const atual = parseBRL(texto);
    if (atual !== valor) setTexto(valor === null ? '' : centsParaTexto(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[0.95rem] text-bruma">
        R$
      </span>
      <input
        inputMode="decimal"
        {...props}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(e.target.value.trim() ? parseBRL(e.target.value) : null);
        }}
        className={`${campo} pl-10 tabular-nums ${props.className ?? ''}`}
      />
    </span>
  );
}

const centsParaTexto = (c: number) =>
  `${Math.trunc(c / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;
